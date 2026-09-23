# Worked example

Real output from `@cclabsnz/sf-orgintel@1.0.0`, captured from a Developer Edition org seeded with
a handful of sample automation. Nothing here is hand-written: both files are what the commands
actually emitted, with two substitutions noted below.

## How they were produced

```sh
sf intel map --target-org <your-org> --output ./out
sf intel anatomy --target-org <your-org> --output ./out
```

Both commands are read-only. They issue SOQL, Tooling and Metadata reads and describes, and write
nothing back to the org.

## What was substituted

- **`orgId`** is replaced with `00Dxx0000000000EAA`, the fixture-id form this repo's pre-commit
  hook documents. The real value identifies a live org and has no business in a public repository,
  which is what that hook exists to enforce.
- **`capturedAt`** is pinned to `2026-09-23T00:00:00.000Z` so the files do not read as a live
  capture and do not churn if regenerated.

Everything else is verbatim.

## What the org contained

Six sample components, all touching standard objects only:

| Component | Kind | What it couples |
|---|---|---|
| `OrgIntelDemo_ContactSync` | Apex class | Account to Contact, reading one and writing the other |
| `OrgIntelDemo_OpportunityRollup` | Apex class | Opportunity to Account, read then update |
| `OrgIntelDemo_TaskFactory` | Apex class | Case and Contact to Task |
| `OrgIntelDemo_CaseTrigger` | Apex trigger | Case to Task, on a path distinct from the class above |
| `OrgIntelDemo_Case_Task` | Flow | Case to Task |
| `OrgIntelDemo_Account_Contact` | Flow | Account to Contact |

## What came out

`graph-fragment.example.json` carries 28 nodes (25 `apexClass`, 2 `flow`, 1 `trigger`), 24 edges
(17 `touches`, 7 `couples`) and 1,532 attribute contributions.

The seven couplings, heaviest first:

| Pair | Weight | Operations |
|---|---|---|
| `Account` to `Contact` | 3 | create, read, update |
| `Case` to `Task` | 3 | create, read |
| `Account` to `Opportunity` | 1 | read, update |
| `Account` to `User` | 1 | create |
| `Case` to `Contact` | 1 | read |
| `Contact` to `Task` | 1 | create, read |
| `Contact` to `User` | 1 | create |

`Account` to `Contact` reaches weight 3 because a Flow and two Apex classes all establish it.
`Case` to `Task` reaches 3 through a trigger, a Flow and a class. Neither pair is a declared
relationship you would find in Schema Builder; both are behavioural couplings established by
automation, which is the thing this tool exists to surface.

## Two honest notes about this output

**Only 2 of 112 flows were analysed.** `intel map` parses Active flows. The org holds 112 flow
definitions and 2 are active, so the analysed population is a small fraction of the census. That
gap is reported rather than hidden: the HTML report and the terminal summary both read "2 of 112",
and the same figures travel in the fragment as `analysed` on `org.root` beside the census
`intel anatomy` contributes to the same node. A count that implies coverage it does not have is
worse than no count.

**1,526 of the 1,531 object contributions are all-zero.** The fragment carries one contribution
per object in the org's sObject catalog, whether or not anything was found for it, and only 5
objects in this org have a non-zero record count or automation count. That is why this file is
400 KB when its nodes and edges together are 13 KB. It is a real characteristic of the 1.0
emission, not an artifact of how the example was captured, and it is worth revisiting.
