# Design: object roles from platform evidence

Status: 2.1, 2.2 and 2.3 implemented in `intel map` (sf-core 0.8.0 `classifyObject`). The sf-orgviz
side of section 3, recording `objectRole` at extraction, is still to do. 2026-10-11. Touches `@cclabsnz/sf-core` (the classifier), `sf-orgintel`
(`intel map`) and `sf-orgviz` (`extract`, the coupling view).

## 1. The problem

`intel map` counts two objects as coupled whenever one automation component touches both. It
then ranks, clusters and draws every object the same way, with a layer label from `roleOf`. On a
real Health Cloud sandbox this produced a picture a Salesforce architect would reject on sight:

- `User` and `RecordType` were among the most-coupled objects in the org. Neither is a business
  entity. `User` is who owns or created a record; `RecordType` is which variant of another object
  a record is.
- `AccountShare` and other `Share`, `History` and `Feed` objects appeared as objects in their own
  right, instead of as parts of the object they belong to.
- Reference data (`CodeSet`, `CodeSetBundle`) ranked above `Case`.
- **Apex test classes were analysed as production automation.** 445 Apex classes were tests,
  identified by their `IsTest` annotation. A test class inserts fixture data for many objects at once, so each
  one adds a burst of couplings that do not exist in the running org. Every `create` of `CodeSet`
  in that org came from a test class.

The cause is not one misclassified object. `roleOf` is a name list of about 45 objects plus suffix
rules, and anything it does not recognise defaults to `business`. It never asks the platform what
an object is, and nothing asks whether a component runs in production.

Industry dictionaries (a Health Cloud list, a Financial Services list) would fix one org at a time
and drift with every release. This design uses only what the platform reports about every object on
every org, and what the org's own automation does with it.

## 2. Two fixes, in order of effect

### 2.1 Test classes are not automation

An Apex class is a test when its `SymbolTable.tableDeclaration.annotations` contains `IsTest`, or
its modifiers contain `testMethod`. When the SymbolTable is withheld, the body's class declaration
is matched for `@isTest`. The class name is never used: `...Test` is a convention, not a rule.

Test classes are listed but not analysed, the same treatment as a class nobody could read: counted
in `apexClassesListed`, excluded from `apexClassesAnalyzed`, and reported in one aggregated note and
one `coverage.unavailable` entry (`map.apexClasses.tests`, reason `deferred`).

This needs no new org read and changes nothing about classification. It is the larger correction
and ships first.

### 2.2 Objects get a role from platform evidence

Each object gets one **role**, decided by the first rule that matches, with the evidence that
decided it recorded alongside.

| Order | Role | Rule | Evidence source |
| --- | --- | --- | --- |
| 1 | `companion` | `associateParentEntity` is set, and the object has no layout and no triggers | `describeGlobal` |
| 2 | `configuration` | `__mdt` suffix, or `customSetting` | suffix, `describeGlobal` |
| 2 | `event` | `__e` suffix | suffix |
| 2 | `external` | `__x` suffix | suffix |
| 3 | `actor` | the target of `OwnerId`, `CreatedById` or `LastModifiedById` | `describe` of system fields |
| 4 | `qualifier` | the target of `RecordTypeId` | `describe` of system fields |
| 5 | `setup` | `EntityDefinition.IsLayoutable` and `IsApexTriggerable` are both false | `EntityDefinition` |
| 6 | `reference` | production automation only ever reads it, and its internal sharing model is `Read` | `EntityDefinition` plus the map's own touches |
| 7 | `entity` | none of the above | — |

Notes on the rules:

- **Companion requires "no layout, no triggers".** The platform also gives `CaseComment` a parent,
  but `CaseComment` is layout-able, triggerable business data. The condition keeps it an entity
  while `Share`, `History`, `Feed` and `ChangeEvent` objects fold into their parent.
- **Actor and qualifier targets are read, not assumed.** On every org measured so far they resolve
  to `User` and `Group`, and to `RecordType`, but the rule reads the system fields' `referenceTo`
  so it holds if the platform ever changes them.
- **Suffixes are platform-defined.** `__mdt`, `__e` and `__x` are part of the API name grammar, not
  naming conventions, so they count as platform evidence.
- **An entity whose sharing is `ControlledByParent`** is recorded as a detail of its parent, but it
  stays an entity: it is real business data.
- **When evidence is missing,** for example `EntityDefinition` is refused, the object's role is
  `unclassified`, with the refusal in `coverage.unavailable`. It does not fall back to `entity`, and
  it does not fall back to the name list.

### 2.3 What the roles change

- **Companions fold into their parent** before pairs are formed. A component touching `Account`
  and `AccountShare` touches `Account`.
- **Only entity↔entity pairs are couplings.** They stay `couples` edges, so every consumer of
  `couples`, including `sf-orgviz`'s coupling view, gets the corrected picture without changes.
- **Every other pair is context, not discarded.** It becomes a `uses` edge carrying the
  non-entity side's role (`actor`, `qualifier`, `setup`, `configuration`, `event`, `reference`).
  "Most of the business model is wired into the permission model" is a real finding (see
  `ARCHITECTURE.md`), and it must survive as its own measurement, not vanish.
- **Ranking, clustering and the report's backbones use entity couplings only.**

## 3. Where it lives

- `sf-core` gains `classifyObject(name, facts): { role, evidence }`, a pure function over an
  `ObjectFacts` record. `roleOf(name)` stays for one minor version, marked deprecated, because
  `sf-orgviz` calls it at extraction and the two tools must not disagree mid-migration.
- `sf-orgintel` collects the facts: `describeGlobal` (already fetched), one `EntityDefinition`
  query for the coupled objects only, and one `describe` to read the system fields' targets.
- `sf-orgviz` records `attrs.objectRole` and its evidence at extraction, using the same function.
  The existing `attrs.role` (the layer) is left alone until the layer model is revisited.

## 4. Measured on a Health Cloud sandbox, prototype rules

Aggregate numbers only. This repository holds no client data.

| | Today | Production code only, entity↔entity |
| --- | --- | --- |
| Coupled pairs | 2,171 | 496 |
| Most-coupled objects | User, Account, CodeSet, CodeSetBundle, Case, HealthcareFacility, RecordType | Account, Case, Contact, ContactPointAddress, ClinicalEncounter, CarePlanDetail, HealthCondition, CarePlan |
| Roles assigned (212 objects) | 7 layers by name | 109 entity, 38 setup, 37 configuration, 13 companion, 12 event, 2 actor, 1 qualifier |

The prototype approximated test detection by class name. The shipped annotation check (2.1) found
445 test classes, more than the name found, and on its own took the map from 2,171 coupled pairs to
1,231, from 212 objects to 174, and from 57 domains to 49.

## 5. Open questions

- **Observability sinks.** Logging objects (Nebula Logger and similar) are written from everywhere
  and read almost nowhere. A behavioural rule ("written by a large share of components, read by
  none") would catch them without a name list, but needs a threshold that holds across orgs. Until
  then they classify as entities, which is noisy but honest.
- **Layers.** `ObjectLayer` (business, security, sharing and so on) overlaps with roles. Once roles
  ship, the layer should be derived from the role rather than kept as a second classification.

## 6. Acceptance

1. Test classes are excluded by annotation, counted and reported, on a real org.
2. Every role decision carries its evidence, and an object with missing evidence is `unclassified`.
3. Validated on the Developer Edition org and one sandbox before any production org.
4. `sf-orgviz`'s coupling view, unchanged, draws only entity couplings from a merged graph.
5. The read-only and network-egress invariants still pass.
