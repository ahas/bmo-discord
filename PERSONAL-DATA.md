# Personal data

No personal data stands in this repository: not the names, handles, account ids, mail addresses, host names,
home paths, domains, devices or network details of the owner and the people they know; not a room member's
display name or id; and not a line of an actual conversation. None of them stands in code, a comment, a
document, a test fixture or a commit message.

- **A value belongs to the installation that holds it.** An address, a host, a path, a port and a credential
  are read from a settings file or the environment; the code that reads one never carries its value.
- **An example is neutral.** A person is `tester` or `qa-admin`, an agent is `agent-a` or `agent-b`, a mailbox
  stands at `example.com`, and a home path names `user`.
- **An agent is named by its identifier,** never by the name a person gives it. The label a person sees stands
  in the deployment's settings.
- **A test's fixtures carry no real person, room or message.** A conversation line a test reads is written for
  the test.
- **Every value of the deployment stands in the settings the two processes read,** and
  `settings.example.env` carries neutral examples (`docs/boundary-api.md`, 「Configuration」).

The testbed's `personal-data` check, which the declaration enables, holds it: it reads every tracked file for a
mail address, a home path, a telephone number, a token and a private network address before anything is built. A finding names the file, the line and the
kind, never the value. The forms are the testbed's policy; no list of the values it forbids is kept here.
