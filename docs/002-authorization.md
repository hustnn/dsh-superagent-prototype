# 002 Authorization

Authorization determines who may start work and what that work may include. This document builds on [001 Domain model](001-domain.md).

The host enforces allowed lists, rules and Mandates. Messages, comments and quoted documents are inputs to a decision; they cannot change those permissions.

## Two paths for a Trigger

### Eval: deciding whether to start work

The Source records whether a message addresses the agent: `mention` for a mention of the bot or agent account, and `direct` for a direct message. The gate checks the sender and the Source's Policy:

- An allowed person who addresses the agent makes an explicit request.
- A person's follow-up on a Thread with Tickets follows the rules below.
- Other human messages use the admission table for their receiving scope.
- A bot on the Source's bot list can produce an inferred candidate, never an explicit request. Other bots are not admitted.

### Subscriptions: continuing existing work

Every message on a subscribed Thread reaches its subscribed Tickets as context, including messages from bots and CI. This delivery bypasses the gate and grants no new authority. Each Ticket remains limited by its Mandate.

A person's message on a Ticket's own Thread belongs to that Ticket's Executor to decide. The same applies when the main Session attaches a message to a Ticket. While an Executor owns the message, it takes no Eval and gets no Decision. Each Executor either handles the request within its Ticket's scope or hands it back for routing elsewhere.

Ownership continues while the Ticket is live, even if a person removes its Subscription. It also covers an ended Ticket that was not stopped by a person and has the message waiting to resume it.

The main Session hears of the follow-up. One whose words may ask to stop, wait or go on wakes it; any other reaches it as a notice it reads at its next turn, and the Executor escalates one it reads as such a request. While an Executor owns the message, the main Session may only stop, hold or release work on the person's request; accept, attach, ignore and requeue are refused. A stop, a hold or a release still passes through the gate with the follow-up strength described below.

### Handing back and releasing follow-ups

An Executor hands a message back once when it asks for work beyond the Ticket's scope or belongs to another Ticket. The Ticket keeps its Subscription. If an attached Thread is unrelated, the Executor hands back the messages it owns there.

A message goes to a fresh Eval only after no Ticket still owns it. Its candidate includes the Executors' reasons. The gate judges it as an ordinary message on that Thread, and the main Session can accept it, attach it elsewhere or ignore it. Handing back a message the Ticket did not own, such as a bot message or one a person already sent to Eval, queues nothing.

When a Ticket ends, it releases follow-ups its Executor did not read or take up. These include messages never delivered to the Executor and messages delivered after its last Report or turn end, provided it neither acknowledged, answered nor handed them back. Each released message goes to Eval when no other Ticket owns it. A stop ends only the stopped Ticket's work.

A stopped Ticket does not send its stop message to Eval again unless another Ticket handed it back. The main Session that stopped it may accept the rest of the message as new work.

A person can send an owned follow-up to Eval from the panel. If the main Session then attaches it back to a live Ticket, the Executor receives it again. The panel also offers re-evaluation when no effective judgement covers the message.

### Context-only subscriptions

An Executor can follow a related Thread, such as another Issue or pull request, for context. Its messages reach the Ticket but grant no authority or follow-up strength. Human messages there do not resume an ended Ticket unless the main Session attaches a message from that Thread. Notes from the main Session about other work are also context only.

Human messages that reach no Ticket, including Threads whose Tickets were stopped by a person, take the Eval path. Bot messages take that path independently of their delivery to subscribed Tickets.

## Strength

| Strength | Cases |
| --- | --- |
| explicit | A person on the list addresses the agent, or follows up on a Thread that already has a Ticket; a cell of the admission table set to explicit request |
| inferred | A person not on the list follows up on a Thread with a Ticket, unless their cell of the admission table is explicit; a cell of the admission table set to inferred candidate; a message of a bot on the Source's bot list that addresses the agent or arrives where the Source receives every message |
| not admitted | Any other bot's message, everything the admission table ignores, and every inferred case while the accept mode is `off` |

For an unlisted person, an explicit admission cell takes precedence even on a Thread with Tickets and works in every accept mode. Otherwise their follow-up is inferred and is not admitted in `off` mode. Messages on Threads followed only for context use the admission table instead of follow-up strength.

## Admission

Each Source's Policy has an admission table. Its rows are receiving scopes:

- **Feishu:** each configured chat, other chats the bot receives mentions from, and direct messages. Other chats are received only when **其他群** is set to **仅 @** on the Feishu card.
- **GitHub:** new Issues, new pull requests, comments and the default branch's CI.

A row has up to three cells. Each cell decides whether a message becomes an explicit request, an inferred candidate or nothing:

| Cell | Choices | Default |
| --- | --- | --- |
| On the list, not addressing the agent | inferred, ignore | inferred |
| Not on the list, addressing the agent | explicit, inferred, ignore | ignore |
| Not on the list, not addressing the agent | inferred, ignore | ignore |

Cells for unaddressed messages are available only where the Source receives every message, such as a Feishu chat set to **全部消息** or a GitHub scope with its receive-all switch enabled. A CI result has no sender, so its row offers only the last cell. Bot messages use the bot list instead of these cells.

Setting the unlisted-addressed cell to explicit lets anyone in that scope request work by mentioning the agent. This can be useful for a dedicated support chat. Inferred candidates still depend on the accept mode. Follow-ups normally bypass this table, except that an explicit cell still grants explicit strength.

The admission table is part of the Policy version. Weakening a cell does not immediately stop open Tickets accepted under it. It can revoke their Mandates when they are revalidated before resuming.

### Bots and automated reviewers

The host recognizes GitHub Apps, logins ending in `[bot]`, and Feishu bots as bots. A Source can list bots such as `dependabot[bot]` whose messages may become inferred candidates. They must either address the agent or post in a scope that receives every message. They cannot make explicit requests or stop Tickets.

An automated reviewer using an ordinary account counts as a person to the host. Its comments reach subscribed Tickets and generate follow-up notices. Team prompt text must identify such accounts as automated reviewers.

## Routing candidates

The main Session routes explicit candidates with `orchestrator_route`. One call can contain several accept, attach, stop, hold, release or ignore decisions. Each item is processed independently: a refused item or a missing field does not prevent the others from running.

An inferred candidate normally needs a full assessment. There is one shortcut: if its card clearly touches no enabled rule, such as plain chat or unrelated discussion, the main Session may ignore it directly. The Decision records `ignoredFromCard` to distinguish this from a rule assessment. The main Session reads the enabled rules in its Policy prompt section.

Accepting an inferred candidate always requires an assessment. Direct accept refuses a Trigger that the gate did not admit as explicit.

## Accept mode and rules

The accept mode is part of the Policy:

| Mode | Effect |
| --- | --- |
| `off` | Nothing inferred becomes a candidate, such as an unaddressed message, a bot's message or the follow-up of a person not on the list |
| `observe` (default) | Inferred candidates are assessed; a positive assessment is recorded as ignore marked "would accept", and nothing is accepted |
| `auto` | A positive assessment of an inferred candidate accepts it |

Explicit requests work in every mode. Start in `observe` and switch to `auto` after reviewing the recorded Decisions. Each assessment judges every enabled rule exactly once, whether it matches or not. A proactive accept requires at least one matching rule.

Each rule describes a kind of proactive work. The Ticket's Mandate records the matched rules, and its Executor receives their names and instructions.

For that Ticket, a rule's process and communication requirements override the defaults. A silence rule can suppress an acknowledgement; a review rule can name the required reviewer and approval before merge. Requirements that apply to every Ticket belong in team prompt sections instead.

## Policy version

Rules, accept mode and each Source's Policy form the Policy version. Every Mandate records the version under which it was accepted.

A version change discards running Evals and queues their Triggers again. It also sends a policy-changed Input to each affected live Ticket. The Input explains whether:

- a matched rule changed, including its new text, or no longer applies;
- the requester may no longer start work; or
- proactive work is no longer accepted, for example because the mode changed from `auto`.

Unaffected Tickets receive no notice. The change does not immediately revoke live Tickets' Mandates.

Source configuration is separate from Policy. It controls what enters the system: which chats are read and whether a scope receives all messages or only mentions. A Mandate records its Source and receiving scope. Resuming needs the Source to still listen to the Thread, but does not require it to still receive every message there.

Replies wait while their Source is off. They are dropped if the Source no longer listens to their destination.

A condition on what the Executor may do with its own result, such as when it may merge, does not decide who may authorize work. It is part of the agent's instructions, not of the Policy.

## Resume and stop

An ended Ticket keeps its Mandate. A person's message on one of its own Threads can resume the same work without a new Eval or Decision, regardless of who sent it. Bots and CI do not wake ended Tickets. The Executor decides whether the request fits the scope and ends the round if it does not.

Only three operations change a Mandate: accept creates it, a person's stop withdraws it, and failed revalidation revokes it. A Ticket stopped by a person stays ended and receives nothing more. Work requested there needs a new accept.

### Revalidation before resume

The Source must still listen to the original Thread. The remaining checks depend on the Mandate's basis:

- An explicit follow-up Mandate passes.
- An inferred Mandate needs `auto` mode and its matched rules still enabled.
- A Mandate admitted by a table cell must still receive at least its original strength under today's table and sender membership. Removing a sender from the list can therefore revoke a Mandate accepted through the listed-sender cell.
- A bot's Mandate requires that bot to remain on the Source's bot list. Inferred table and bot Mandates also need `auto` mode and enabled matched rules.
- Other Mandates require the sender to remain on the Source's allowed list.

If revalidation fails, the Ticket stays ended and takes none of its waiting messages. Each message is treated as having reached no Ticket; if no other Ticket owns it, it goes to Eval. The main Session is not told it reached a worker. This also applies after a processing pause. Attaching to the Ticket is refused, and further work requires a new accept.

- **A person saying "stop" in a Thread is an ordinary Trigger,** and Eval decides stop. An Executor cannot declare that a person asked it to stop.
- **Stop in the panel is a command.** It acts on the Ticket directly and is recorded as a manual stop.

### Hold and release

A person who asks a live Ticket to wait, such as for a product decision, puts it on hold; one who says to go on lifts the hold. Both are ordinary Triggers that Eval decides, as a stop is: the gate must give the message explicit strength, so a guest's message, an unknown or ended Ticket, and a release of a Ticket that is not on hold are recorded as `ignore` with `holdNotExplicit`, `holdUnknown` or `notHeld`. The panel holds and releases directly, as it stops. An Executor cannot lift a hold: it escalates a message it reads as asking to stop, wait, take the work over or go on, and only a person's message, through Eval, or the panel lifts one.

A hold changes no Mandate and ends nothing. While it lasts:

- automatic Inputs, such as CI and bots, are recorded but not delivered, as for a `blocked` Ticket, while a person's messages still reach the Executor, which may read and answer them;
- the Engine refuses a `ready` Report, an acknowledgement of new work and a result reply;
- the Executor's prompt carries a Hold section on every model request, so compaction and restarts keep it, and its tool guard refuses file writes, commits, pushes and GitHub or Feishu writes, unless a person typed the latest message into the Executor Session after the hold began. Like blocked commands, the guard is a default, not a security boundary.

A Ticket keeps its first hold until a person lifts it; the release delivers a `released` Input that tells the Executor to look at what came meanwhile and go on. The Ticket's end clears the hold. A hold or a release settles the message that asked for it, so that message does not go to Eval again when the Ticket ends.

Two holds lift on more than a go-ahead:

- **A checkpoint** is the Executor's hold on its own Ticket: a Report whose `human_action` question has `checkpoint` set holds the Ticket on that question, so the Executor changes nothing until a person approves. The Executor narrows only its own work, which needs no authority, and still cannot lift it. A person's approval is a release, decided as any release; it clears the question with the hold, and the `released` Input says that the person approved. A new question with `checkpoint` moves the hold to it.
- **A takeover** is a person's hold that also ends the Executor's Assignments: `orchestrator_route` kind `takeover` on a person's message, or the panel's Take over. It replaces any other hold. The Executor Session, directory and branch stay for the person, who may also drive the Executor Session; nothing reaches the Executor, and the person's messages wait. The handback is a release: it starts a new Assignment, whose `released` Input tells the Executor to read the person's commits and changes and keep them. A pull request that merges or closes meanwhile ends the Ticket as it would without the takeover.
- **Waiting conditions belong to Sources.** A condition such as "no assignee for N hours" would be a Source that waits and checks again itself; Eval never waits.

## When Eval does not finish

The time limit starts when the candidate reaches the main Session. Time spent waiting for delivery does not count, and an undelivered candidate never expires.

An expired Eval queues its Triggers for another attempt. After two consecutive retries, the third expiry records `unavailable`. An assessment failure also records `unavailable`; a later Trigger can start a new Eval. A Policy change or a decision made against an outdated Policy records `unavailable` and immediately queues the batch under the current version.

The `evals` health entry reports unresolved unavailable Decisions from the last hour. `scripts/dsh-superagent status` includes that error.

The panel asks for human attention only when the unavailable Decision is less than 24 hours old, is still the latest Decision on its Thread, has not been dismissed, and the Thread is neither queued nor evaluating. A person can evaluate the Trigger again or dismiss the problem.
