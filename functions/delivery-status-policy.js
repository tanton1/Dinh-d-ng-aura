'use strict'

// Shared by queries, change signals and GPS authorization so active-job
// counters and invalidations cannot silently use different status sets.
const ACTIVE_DELIVERY_STATUSES = Object.freeze([
  'awaiting_kitchen', 'awaiting_assignment', 'assigned',
  'accepted', 'at_store', 'picked_up', 'arrived',
])
const GPS_DELIVERY_STATUSES = Object.freeze(['accepted', 'at_store', 'picked_up', 'arrived'])
module.exports = { ACTIVE_DELIVERY_STATUSES, GPS_DELIVERY_STATUSES }
