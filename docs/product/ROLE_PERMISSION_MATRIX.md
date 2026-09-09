# Role and Data Permission Matrix

| Role | Student scope | Finance | Workout/nutrition detail | Progress photos | Operational actions |
| --- | --- | --- | --- | --- | --- |
| PT chính/phụ | Assigned learners | Status only | Yes | Yes | Assigned actions |
| Coach online | Assigned nutrition learners | Status only | Nutrition and progress | Yes | Assigned actions |
| Sales | Assigned learners/renew cases | Contract status and renew | No detailed training data | No | Assigned sales actions |
| Branch manager | Branch | Amounts only with `branch.finance.view` | Operations only | No | Branch actions |
| Admin | Authorized system scope | According to capability | Yes | Yes | All authorized actions |
| Super Admin | All | All | Yes | Yes | All and rollout/migration controls |

The server callable is the enforcement point. Client visibility is only a presentation concern.

