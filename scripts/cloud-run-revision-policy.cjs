'use strict'

const { assertReadyForPromotion } = require('./recover-function-revisions.cjs')
const shortName = (value) => String(value || '').split('/').at(-1) || ''

function revisionResource(service, revision = service.latestCreatedRevision) {
  if (!revision) throw new Error('Service has no latest revision.')
  const resource = revision.startsWith('projects/') ? revision : `${service.name}/revisions/${revision}`
  if (!resource.startsWith(`${service.name}/revisions/`)) throw new Error('Revision belongs to another service.')
  return resource
}

function assertHealthyRevision(service, revision, { expectedRevision, expectedImage, requireServing = false } = {}) {
  const resource = revisionResource(service)
  if (expectedRevision && shortName(resource) !== shortName(expectedRevision)) throw new Error('Concurrent release changed the expected revision.')
  if (revision.name !== resource) throw new Error('Revision identity does not match the release candidate.')
  const image = revision.containers?.[0]?.image
  if (revision.containers?.length !== 1 || !/@sha256:[a-f0-9]{64}$/.test(image || '')) throw new Error('A resolved immutable image digest is required.')
  assertReadyForPromotion(service, revision, expectedImage || image)
  if (requireServing && !servesRevision(service, revision.name)) throw new Error('Expected healthy revision is not receiving 100% traffic.')
  return { revision: shortName(revision.name), image }
}

function servesRevision(service, revision) {
  // Configured traffic is intent, not evidence that reconciliation completed.
  const positive = (service.trafficStatuses || []).filter((target) => Number(target.percent) > 0)
  return positive.length === 1 && Number(positive[0].percent) === 100
    && shortName(positive[0].revision) === shortName(revision)
}

module.exports = { shortName, revisionResource, assertHealthyRevision, servesRevision }
