# Case type skill

Motor vehicle: AUTO_ACCIDENT, TRUCK_ACCIDENT, MOTORCYCLE_ACCIDENT, RIDESHARE_ACCIDENT, BICYCLE_PEDESTRIAN. Validate incident existence separately from fault. The CaseClosedFL public hard stop is claimant-primary fault; `OTHER_PARTY`, `NOT_SURE`, and `SHARED` do not by themselves establish legal non-fault. Final VALIDATED status requires evidence supporting the configured non-primary-fault requirement.

Truck: also accept carrier name / USDOT identifiers as optional corroboration inputs; federal carrier identity may be validated separately from crash existence.

Rideshare: rideshare company involvement is an attribute of the incident; it does not make the crash itself verified.

Slip/fall: business/property registry validation proves the entity/premises exists, not that the fall happened. Occurrence evidence must come from an incident document or another lawful source.

Provider lookup proves provider/license existence, not that the claimant received treatment.

Court lookup can reveal matching litigation, but absence of a lawsuit does not prove absence of attorney representation.
