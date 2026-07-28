# Permissions

`sf intel` is **strictly read-only**. It issues SOQL queries, Tooling queries, REST **GET**s and
Metadata reads only — no DML, no deploys, no writes of any kind. That is enforced as a test
(`test/unit/invariants/readonly-invariant.test.ts`), not just stated here.

It runs under the permissions of the authenticated `sf` user. Anything that user cannot read is
reported as a note in the output rather than failing the run, so a low-privilege user still gets
a partial, clearly-labelled result.

## Minimum access

| Permission | Why |
| --- | --- |
| **API Enabled** | All access is through the API. |
| **View Setup and Configuration** | Reads `Organization`, `EntityDefinition`, `AppMenuItem`, `RecordType`, `InstalledSubscriberPackage`. |
| **View All Data** *(or read on the objects you want analysed)* | `intel discover` counts records per object to rank anchors; objects the user cannot read are skipped with a note. |
| **Author Apex** *(read-only use)* | Required by the platform to query `ApexClass` and `ApexTrigger` bodies via the Tooling API. Grants no ability to write Apex through this tool. |
| **Manage Flow** *or* **View All Flows** | Required to read `FlowDefinitionView` and `Flow.Metadata`. Without it, `intel map` degrades to Apex-only coupling and says so. |

## Per-command detail

**`sf intel probe`** — org capability and evidence coverage.
`Organization`, the global describe (`/sobjects/`), `EventLogFile` (presence only), field-history
settings, and read probes against the standard behavioural tables. Needs *View Setup and
Configuration*; **View Event Log Files** improves the evidence tier but is not required — its
absence lowers the tier rather than failing.

**`sf intel discover`** — anchor ranking and domain fingerprint.
Adds `EntityDefinition`, `RecordType`, `AppMenuItem`, `InstalledSubscriberPackage`,
`ProcessDefinition`, `WorkflowRule`, `ApexTrigger`, `FlowDefinitionView`, plus `COUNT()` queries
and `Task`/`Event`/`EmailMessage` activity counts per candidate object.

**`sf intel map`** — cross-object coupling graph.
Adds `ApexClass` (`Body`, `SymbolTable`) and `Flow.Metadata` per active flow version.
This is the command most sensitive to permissions: without Apex or Flow read the graph is built
from whatever remains, and every gap is reported in `notes`.

## What it never needs

- **No write permission of any kind** — not Modify All Data, not Customize Application for
  deployment, not Author Apex for saving code.
- **No Shield or Event Monitoring licence.** Their absence lowers the reported evidence tier
  (A → B/C); it does not block any command.
- **No network access beyond your org.** Enforced by
  `test/unit/invariants/network-egress.test.ts`: no telemetry, no analytics, no LLM calls, and
  no remote assets in generated reports.

## Suggested permission set

A dedicated read-only integration user is the safest way to run this. Grant:

- `PermissionsApiEnabled`
- `PermissionsViewSetup`
- `PermissionsViewAllData` (or object-level Read on the objects in scope)
- `PermissionsAuthorApex` — required by the platform for Tooling reads of Apex
- `PermissionsManageFlow` — required for Flow metadata reads

If your policy forbids `Author Apex` or `Manage Flow` on an integration user, the tool still
runs; it reports reduced coverage instead of failing.

## Data handling

Generated reports contain your org's object names, automation names and record volumes. They are
written only to the `--output` directory you specify and are **fully self-contained** — opening
one makes no network request. Analysis is cached locally under `~/.orgintel/cache/<orgId>`, keyed
by a content hash; delete that directory to clear it.
