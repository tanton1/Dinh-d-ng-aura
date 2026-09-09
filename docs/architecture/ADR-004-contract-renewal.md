# ADR-004: Contract actions stay in the Student 360 workspace

Renew, extension, freeze, payment and refund commands continue to use existing server policies. Student 360 may lazy-load the contract workspace, but must not duplicate contract mutation logic in the UI or Action Center.

