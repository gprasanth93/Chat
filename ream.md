ARK Day-2 Operations — Self-Service Release Architecture

For PgMaker, I would build one reusable Release Engine that turns user-requested database changes into approved, versioned, auditable workflows.

This solves three problems together:

* Self-service: Users can request changes to their databases without manually coordinating each operational step.
* Compliance: Production changes cannot execute until ServiceNow confirms all three required approvals and the authorized implementation window.
* Reliability: A runbook performs prechecks, invokes PgMaker Command, waits for completion, verifies database health, and either proceeds or safely stops.

The most important architectural decision is:

ARK should orchestrate the request experience, but PgMaker must remain the authority for database operations.

1. Recommended architecture

ARK Portal

Select operation · Preview impact · Track release

PgMaker Release Engine

Planning · Policy checks · Scheduling · Durable workflow execution

ServiceNow

Approvals and change window

Nexus

Immutable runbooks and release bundles

Existing PgMaker Command

Executes one validated, idempotent primitive at a time

PgMaker / VM Control

Topology, placement, lifecycle

Host / Database Profile

Health and postchecks

This is deliberately not a replacement for PgMaker Command. It is the missing orchestration layer above your existing execution primitives.

2. The end-to-end release lifecycle

1. User creates an operation request

Selects a database and an operation, such as changing max_connections or resizing a VM.

2. PgMaker generates a release plan

Determines affected nodes, risk, expected impact, required runbook, prechecks, postchecks, and rollback strategy.

3. Release package is published to Nexus

The exact plan and approved runbook version are pinned by an immutable artifact digest.

4. ServiceNow handles three approvals

Approval groups and implementation ownership are derived using the database’s EIM ID and authoritative service ownership records.

5. Execution starts within the approved change window

Each step resolves its current target, rechecks safety, executes through PgMaker Command, and persists its result.

6. Postchecks and release closure

Database health, replication, and expected configuration are verified. Evidence is attached to the release and linked to ServiceNow before closure.

The user experiences one operation. The platform coordinates all the steps.

ServiceNow already exposes Change Management APIs for creating and retrieving changes, processing approvals, managing change tasks, risk evaluation, and scheduling conflicts. Its change models can impose transition criteria, which is preferable to recreating approval workflow logic inside ARK. servicenow.com

3. What should be available as self-service?

Every operation should use the same Release Engine, but each has a different safety policy.

Operation	Runbook behavior	Production safeguards
Update PostgreSQL config	Validate → update desired config → apply → reload/restart if required → verify	Protect replication and check pending restart
Resize VM	Check placement/capacity → resize → restart if necessary → verify	One node at a time; preserve availability
Restart node	Precheck → restart → wait for readiness → verify	Require healthy replica/quorum conditions
Promote standby	Verify candidate → fence old primary → promote → reconcile topology → verify	Prevent split brain; require eligible candidate
Remove node	Validate target → drain/decommission → update topology → remove	Protect minimum replica count and durability
Remove all database nodes	Validate dependencies and retained backups → approved decommission workflow	Separate destructive-change policy and stronger controls

For the existing PgMaker topology of a primary, one synchronous standby and two asynchronous standbys, the runbook must account for replication health and synchronization, not simply the number of running processes.

For example, restarting a synchronous standby that is required for commit acknowledgement may affect write availability. A runbook must understand the current synchronous replication configuration before taking that standby offline.

Similarly, resizing the primary can require a different plan from resizing an asynchronous standby.

4. The biggest problem: nodes move and roles change

This is the architectural weakness I’d solve before enabling production self-service.

Today, a queued PgMaker Command may effectively say:

{
  "action": "restart",
  "host": "host-17",
  "role": "sync-standby"
}

But the release may not execute until hours or days later.

By then:

* The node could have moved to another host.
* The synchronous standby could have been promoted.
* A different node could now occupy that role.
* The database configuration or topology could have changed.

A static hostname or role is therefore not a safe long-lived operation target.

Replace physical targets with stable logical identities

Current approach

Target fixed during planning

host-17
sync standby

Can become stale before execution.

Proposed approach

Stable identity plus runtime constraints

db-42
node-007
requires sync standby

Resolve current host and role immediately before execution.

Here is an example of the command contract I’d introduce:

{
  "operationId": "REL-1042-step-03",
  "databaseId": "db-42",
  "nodeId": "node-007",
  "action": "restart",
  "expectedRole": "sync-standby",
  "expectedTopologyEpoch": 184,
  "changeId": "CHG0012345"
}

The execution path should:

* Resolve the node’s current host from PgMaker’s authoritative node/VM inventory.
* Verify the stable node ID still belongs to that database and has the approved role.
* Validate the actual topology and replication state.
* Dispatch the primitive with a precondition/fencing token, not just a hostname.
* Have the final executor or VM Control validate identity and fencing immediately before performing the action.

The last point is essential. A topology lookup followed by an ordinary hostname-based command still has a time-of-check/time-of-use race. The executor needs to reject stale ownership or topology tokens.

What happens if something changes after approval?

Change between approval and execution	Recommended behavior
Same node moved to another host	Re-resolve and continue, if approved scope and safety remain unchanged
Same node changed from standby to primary	Pause; require a new plan and approval if the impact changes
Intended node no longer exists	Stop and report invalid target
Another node became synchronous standby	Do not silently restart the new standby
Database configuration revision changed	Detect drift, replan, and reassess approval
A prerequisite replica is unhealthy	Pause before execution

Automatic re-resolution is good. Automatic re-interpretation of an approved change is dangerous.

That distinction lets you preserve the intent of the approval while accommodating normal PgMaker node movement.

5. Solving PgMaker Command’s single-operation limitation

I would deliberately keep PgMaker Command as the primitive executor.

It should be excellent at one action: restart this verified node, apply this validated configuration, or initiate an authorized promotion.

The Release Engine is responsible for combining those individual actions into a safe sequence.

For example, a PostgreSQL configuration-change runbook:

Runbook: Apply PostgreSQL configuration

Illustrative workflow

1

Validate approved change and execution window

ServiceNow status, digest, permissions and change freeze

2

Acquire database operation lease

Prevent conflicting mutations

3

Resolve topology and run prechecks

Primary, standbys, replication health and current config revision

4

Apply configuration through PgMaker

Update the authoritative desired config and await applied state

5

Determine reload versus restart

Use the actual PostgreSQL setting’s restart requirement

6

Restart affected standbys sequentially

Only when required; wait for recovery and replication catch-up

7

Handle primary according to the approved plan

Restart or controlled switchover only when explicitly authorized

8

Perform postchecks and capture evidence

Validate effective settings, availability and replication

9

Complete release

Persist audit evidence and update ServiceNow

Not every configuration change should trigger a restart. Some settings can be reloaded; others require a restart, and some require special handling. The runbook should decide based on validated metadata and actual applied state.

This is a much stronger model than simply chaining several PgMaker Command requests in the browser.

6. ServiceNow: integrate compliance, don’t recreate it

You mentioned three mandatory approvals. I’d keep ServiceNow authoritative for all three and make ARK display their progress.

The EIM ID is the right starting point for identifying the business service, ownership groups, and implementation group. But the mappings should come from an authoritative CMDB/ownership integration, rather than assuming the EIM ID itself contains approval authority.

Example release approval view

Change request

CHG0012345

Awaiting approval

Approval 1 — Application ownership

Resolved from the database EIM ID

Approved

Approval 2 — Technical approval

Configured ServiceNow approval policy

Approved

Approval 3 — Change authorization

Configured change authority / CAB policy

Pending

Production execution

Blocked

The labels are illustrative; use your organization’s actual three approval stages, change model, and separation-of-duties rules.

At execution time, the release service must independently confirm that the change remains authorized, all required approvals are valid, the implementation window is open, and the exact package is still the approved version.

ServiceNow supports configurable approval policies and workflow transitions, so there is no need for ARK to implement its own approval engine. servicenow.com +1

Do not let ARK’s integration service approve its own changes. It should create changes, read approvals, link evidence, and perform approved lifecycle transitions only within its delegated permissions.

Also, approval status isn’t permanent. If someone changes the target database, planned action, parameters, or material risk after approval, invalidate the existing execution authorization and seek renewed approval where policy requires it.

7. Runbook packaging and Nexus auditing

I would distinguish between two artifacts.

Artifact	Purpose	Versioning
Runbook artifact	Defines the approved sequence, checks, handlers and failure policy	Versioned, such as postgres-config-1.3.0
Release package	Captures one user’s specific approved change, parameters and target intent	Unique ID, such as REL-1042

Both belong in Nexus, but they serve different audit needs.

An example release manifest:

apiVersion: pgmaker.io/v1
kind: Release
releaseId: REL-1042
databaseId: db-42
eimId: EIM-12345
environment: production
change:
  number: CHG0012345
  sysId: "<ServiceNow record ID>"
runbook:
  name: postgres-config-apply
  version: 1.3.0
  digest: "sha256:<approved-runbook-digest>"
operation:
  type: update-postgres-config
  changes:
    max_connections: 500
target:
  scope: database
  topologyPolicy: revalidate-before-each-step
checks:
  preflight: required
  postflight: required
failurePolicy:
  onUnsafeState: pause
  onUnknownExecutionResult: manual-review

In the actual package, replace the illustrative digest with a verified cryptographic digest and bind that package’s own digest to the ServiceNow change.

Nexus supports a Disable redeploy policy for hosted repositories, preventing an existing component version from being overwritten. Use that along with restricted publishing permissions, artifact checksums, signatures or approved provenance, and retention controls. help.sonatype.com +2

The execution service should not download arbitrary shell scripts from Nexus and execute them as a privileged user. Instead, it should load approved, typed runbook definitions whose steps map to allowlisted PgMaker operation handlers.

This gives you auditable runbook versions without creating an unrestricted remote-code-execution mechanism.

The release package is immutable. Execution logs, check results, and evidence should be stored separately and associated with its digest.

8. Make release execution durable and resumable

This is another critical component.

A release might take several minutes, involve restarts, or wait for replication to catch up. It must survive ARK restarts, worker crashes, and temporary connectivity failures.

I’d introduce a small durable workflow state model:

Release lifecycle

DraftPackagedAwaiting approvals

ApprovedScheduledExecuting

CompletedPausedFailed

Paused and failed releases require explicit reconciliation, recovery, or an authorized resumption path.

Each completed step is persisted. If a worker crashes after restarting a standby, the next worker must discover whether that command actually completed before attempting anything again.

Every primitive needs an idempotency key and a durable execution status. Never blindly retry promotion, deletion, or restart when the previous outcome is unknown.

Two approaches are reasonable:

Approach	When to use
Existing PgMaker PostgreSQL plus a small Node.js workflow worker	Best starting point if PgMaker already has reliable durable job infrastructure
Temporal	Worth considering if your platform already operates it or requires complex, long-running workflow recovery at scale

Temporal provides persisted workflow history, replay, durable activities, and retry handling, but it introduces another substantial platform dependency. Temporal Documentation +1

For your preference for simple, maintainable Node.js services, I’d start with PgMaker’s existing durable command infrastructure, enhancing it where necessary rather than immediately introducing Temporal.

The Release Engine must also allow only one conflicting mutating release per database at a time. Use durable database-level operation leases, queue claims, and fencing rather than an in-memory lock. PostgreSQL advisory locks are available, but their application-defined semantics mean they must be paired with an appropriate persistent workflow ownership model. postgresql.org

A key distinction from your earlier ARK architecture: the release-state database cannot be optional. If it is unavailable, the operational dashboard can remain readable, but new production mutations must be blocked. Audited workflow state is safety-critical.

9. What does the user see in ARK?

I’d make the user interface a single Day-2 Operations workspace inside each database page.

DATABASE WORKSPACE

payments-prod

Production

Day-2 operations

Update configuration

Resize VM

Restart node

Promote standby

Remove node

Decommission database

Recent releases

REL-1042 — Configuration change

CHG0012345 · Scheduled window

Pending approval

REL-1038 — VM resize

Prechecks and postchecks recorded

Completed

Conceptual layout, not a live release-management interface.

Selecting an action should open a guided flow: configure the request, preview impact and execution steps, choose a permitted window, submit for approval, then monitor its progress.

For users, this becomes much easier than creating a ServiceNow request manually, figuring out server names, and running multiple disconnected commands.

10. A safe way to introduce this incrementally

Phase	Deliverable	Scope
1	Release planning and ServiceNow integration	Generate plans, packages, approvals, no production execution
2	Durable orchestration and identity-aware command execution	Restart a single nonproduction standby with pre/postchecks
3	Config and VM lifecycle runbooks	Config apply/reload/restart and VM resize
4	Production release execution	Full three-approval enforcement, windows, audit evidence
5	Advanced topology operations	Promotion, standby removal, decommission with stricter policies

I would start with restart standby as the first complete technical workflow. It exercises the hardest reusable plumbing: identity-aware targeting, current topology validation, command execution, readiness, replication health, recovery, and evidence collection.

Then add configuration updates, which can reuse almost all of that machinery.

Promotion and decommission should come later because they involve substantially greater availability and data-loss risks.

11. Where each responsibility should live

Component	Responsibility
ark-portal	Request forms, impact preview, approval status, live execution progress
pgmaker-release	Release planning, policies, artifact binding, ServiceNow integration, durable runbook coordination
pgmaker-command	Execute individual guarded primitives, report durable status and results
PgMaker control plane	Authoritative database identity, topology, roles, placement, and desired configuration
Host Profile / Database Profile	Fresh operational observations and verification signals
ServiceNow	Approval policy, change authorization, schedule and implementation governance
Nexus	Approved runbook versions, immutable release packages and audit artifacts

pgmaker-release is a proposed logical component. It can initially be a module and worker deployment in your existing Node.js control plane; it doesn’t need to become an independently managed microservice on day one.

Final architectural recommendation

I would base ARK Day-2 Operations on these four rules:

One user intent → one release → one approved immutable package → many verified execution steps.

The user shouldn’t need to manage multiple commands, and the browser shouldn’t be trusted to perform database mutations.

Late-bind location, but preserve approved intent. Nodes can move hosts, but the release must never silently change which database node or risk class was approved.

Make correctness observable. A command returning HTTP 200 isn’t success. Success is the intended database state being reached, observed, and recorded with sufficient freshness and evidence.

Keep compliance external and enforce it internally. ServiceNow owns the approvals, Nexus owns the versioned artifacts, and the PgMaker Release Engine independently enforces both at execution time.

The most important technical prerequisite is upgrading PgMaker Command to support stable node identities, execution-time preconditions, idempotent command IDs, and queryable results. Without those capabilities, even a sophisticated runbook engine cannot reliably handle node movement, role changes, or uncertain command outcomes.

Once that foundation exists, self-service configuration changes, restarts, VM resizing, and eventually promotions can share a single controlled implementation rather than becoming separate, difficult-to-audit workflows.