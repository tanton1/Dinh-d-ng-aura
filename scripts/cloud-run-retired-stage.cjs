'use strict'

const { randomUUID } = require('node:crypto')
const { recoveryBody, assertHealthyServingRevision, platformReadinessRevisionName, recoverWithPlatformReadiness } = require('./recover-function-revisions.cjs')
const { shortName, assertHealthyRevision, servesRevision } = require('./cloud-run-revision-policy.cjs')

function isRetired(revision) {
  return revision.conditions?.some(condition => condition.revisionReason === 'RETIRED') === true
}

function assertStagingTraffic(service, previous, candidate) {
  const targets = service.traffic || []
  if (targets.length !== 2
    || !targets.some(target => target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && shortName(target.revision) === previous && Number(target.percent) === 100 && !target.tag)
    || !targets.some(target => target.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && shortName(target.revision) === candidate && !Number(target.percent) && target.tag === 'rvc')
    || !servesRevision(service, previous)) throw new Error('Staging no longer preserves the previous revision at 100 percent.')
}

// A pinned rollout can leave the new revision RETIRED before it ever starts.
// Start one copy of that exact image behind a zero-traffic route. Neither the
// source nor the serving percentage changes until normal health gates pass.
// https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration
async function stageRetiredCandidate(current, revision, headers, {
  request, pause, expectedRevision, expectedImage, platformReadinessGate = false,
  nonce = randomUUID().replace(/-/g, '').slice(0, 12), log = () => {},
} = {}) {
  const resource = current.latestCreatedRevision
  const image = revision.containers?.[0]?.image
  if (!isRetired(revision) || revision.name !== resource || current.reconciling || !current.etag
    || !current.latestReadyRevision || current.latestReadyRevision === resource) throw new Error('Only an idle retired candidate with a stable earlier release can be staged.')
  if (expectedRevision && shortName(resource) !== shortName(expectedRevision)) throw new Error('Concurrent release changed the expected revision.')
  if (expectedImage && image !== expectedImage) throw new Error('Retired image differs from the approved image digest.')
  if (!revision.conditions.some(condition => condition.type === 'ContainerReady' && condition.state === 'CONDITION_SUCCEEDED')
    || revision.conditions.some(condition => condition.state === 'CONDITION_FAILED' && condition.revisionReason !== 'RETIRED')) throw new Error('Candidate has a startup failure that requires investigation.')
  if (current.traffic?.length !== 1 || current.traffic[0].type !== 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'
    || Number(current.traffic[0].percent) !== 100 || current.traffic[0].tag
    || shortName(current.traffic[0].revision) !== shortName(current.latestReadyRevision)) throw new Error('Staging requires one exact previous traffic pin and no existing tags.')
  if (current.scaling?.scalingMode === 'MANUAL' || Number(current.scaling?.manualInstanceCount || 0)
    || Number(revision.scaling?.minInstanceCount || 0)) throw new Error('Manual scaling or a warm floor requires separate rollout review.')
  if (!/^[a-z0-9]{12}$/.test(nonce)) throw new Error('A unique bounded staging nonce is required.')
  const functionName = current.template?.containers?.[0]?.env?.find(item => item.name === 'FUNCTION_TARGET')?.value
  if (!/^[A-Za-z][A-Za-z0-9]+$/.test(functionName || '')) throw new Error('Managed function entrypoint is missing.')
  if (platformReadinessGate) {
    // Explicit exception for names that cannot have a tagged staging URL.
    // Reuse the recovery path's native startup gate, exact image/traffic
    // verification and ownership-checked rollback; never retry a mutation.
    const candidate = platformReadinessRevisionName(current.name, nonce)
    const operationPrefix = current.name.split('/services/')[0] + '/operations/'
    const expectedResource = `${current.name}/revisions/${candidate}`
    const operationDone = async (initial, timeoutMs = 600_000) => {
      const operationName = initial.name
      if (!operationName?.startsWith(operationPrefix)) throw new Error('Unexpected platform operation identity; inspect before retrying.')
      let operation = initial
      for (let attempt = 0; !operation.done && attempt < Math.ceil(timeoutMs / 2500); attempt++) {
        await pause(2500)
        operation = await request(`https://run.googleapis.com/v2/${operationName}`, headers)
        if (operation.name !== operationName) throw new Error('Unexpected platform operation identity; inspect before retrying.')
      }
      if (!operation.done) throw new Error('Platform operation still pending; inspect before retrying.')
      if (operation.error) throw new Error('Platform startup failed; inspect the recorded operation.')
      if (operation.response?.name !== current.name || operation.response?.latestCreatedRevision !== expectedResource) throw new Error('Platform operation did not produce the exact candidate.')
      return operation
    }
    const service = await recoverWithPlatformReadiness({
      api: (url, options) => request(url, headers, options), operationDone, record: log,
      service: current, revision, functionName, candidateRevision: candidate,
    })
    const ready = await request(`https://run.googleapis.com/v2/${expectedResource}`, headers)
    assertHealthyRevision(service, ready, { expectedRevision: candidate, expectedImage: image, requireServing: true })
    return { service, revision: ready, expectedRevision: candidate, expectedImage: image }
  }
  const body = recoveryBody(current, revision, functionName)
  const candidate = `${shortName(current.name)}-stg-${nonce}`
  const previous = shortName(current.latestReadyRevision)
  body.template.revision = candidate
  body.template.healthCheckDisabled = false
  body.traffic[1] = { type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision: candidate, percent: 0, tag: 'rvc' }

  const previousRevision = await request(`https://run.googleapis.com/v2/${current.latestReadyRevision}`, headers)
  assertHealthyServingRevision(current, previousRevision, previousRevision.containers?.[0]?.image, previous)
  if (Number(previousRevision.scaling?.minInstanceCount || 0)) throw new Error('The previous revision has a warm floor requiring separate review.')
  const url = `https://run.googleapis.com/v2/${current.name}`
  log({ status: 'staging_retired', previous, candidate, image })
  // No mutation retry. A timeout is an uncertain operation, not authorization
  // to create another revision. The etag rejects a concurrent configuration.
  let operation = await request(`${url}?updateMask=template.revision,template.containers,template.healthCheckDisabled,traffic&forceNewRevision=true`, headers, { method: 'PATCH', body: JSON.stringify(body) })
  const operationPrefix = current.name.split('/services/')[0] + '/operations/'
  if (!operation.name?.startsWith(operationPrefix)) throw new Error('Unexpected staging operation identity; inspect before retrying.')
  const operationName = operation.name
  log({ status: 'staging_operation', candidate, operation: operation.name })
  for (let attempt = 0; !operation.done && attempt < 240; attempt++) {
    await pause(2500)
    operation = await request(`https://run.googleapis.com/v2/${operationName}`, headers)
    if (operation.name !== operationName) throw new Error('Unexpected staging operation identity; inspect before retrying.')
  }
  if (!operation.done) throw new Error('Staging operation still pending; inspect before retrying.')
  if (operation.error) throw new Error('Staging failed; previous traffic remains pinned. Inspect the recorded operation.')
  const expectedResource = `${current.name}/revisions/${candidate}`
  if (operation.response?.name !== current.name || operation.response?.latestCreatedRevision !== expectedResource) throw new Error('Staging operation did not produce the exact candidate.')
  const service = await request(url, headers)
  if (service.name !== current.name || service.latestCreatedRevision !== expectedResource) throw new Error('Concurrent release changed the staged candidate.')
  assertStagingTraffic(service, previous, candidate)
  const ready = await request(`https://run.googleapis.com/v2/${expectedResource}`, headers)
  assertHealthyRevision(service, ready, { expectedRevision: candidate, expectedImage: image })
  return { service, revision: ready, expectedRevision: candidate, expectedImage: image }
}

module.exports = { isRetired, stageRetiredCandidate }
