# Lab guides

A lab guide is a Markdown file that walks someone through a lab, step by step. Its code blocks can run their commands on the lab's nodes or type them into a node's terminal, and the reader ticks off each block as they go.

Put the guide next to the topology, with the same name and the `.clab.md` suffix:

```text
srl-pair.clab.yml
srl-pair.clab.yml.annotations.json
srl-pair.clab.md
```

When you open the topology, the side panel switches to its **Guide** tab. The guide works the same in the web app, the desktop app and VS Code. In the browser sandbox, which runs no labs, its blocks can be copied but not run.

A lab without a guide shows how to start one in the same tab: **Create guide** writes a first guide with the lab's own node names and opens it in your editor. Its example commands fit the nodes: `show version` for a node whose shell is a network OS CLI, shell commands for the others. It never replaces a file that is already there, and it waits until the lab is unlocked.

## An example

````markdown
---
title: Two SR Linux routers, one link
duration: 15m
---

Bring up the link between [srl1](node:srl1) and [srl2](node:srl2).

## Meet the routers

Ask each router for its version:

```sh exec=srl1,srl2
sr_cli "show version"
```

## Configure the link

Open the CLI on srl1 and enter the configuration:

```srl terminal=srl1
enter candidate
set / interface ethernet-1/1 admin-state enable
set / interface ethernet-1/1 subinterface 0 ipv4 address 192.168.0.1/30
commit now
```
````

## Writing a guide

- **Front matter**, between `---` lines at the top, can set the `title` and the `duration`. Without a title, the first `#` heading names the guide.
- **Steps**: each `##` heading starts a step. The text before the first step is the introduction, shown with the first step.
- **Node links**: `[srl1](node:srl1)` centers the canvas on the node, and the guide stays open.
- **Code blocks** are copied, run or typed, depending on what follows the language word:

| Fence | The block's button |
| --- | --- |
| ` ```sh ` | Copy only. |
| ` ```sh exec=srl1,srl2 ` | **Run** runs the command on each node with `containerlab exec`, and shows what each node printed under the block. The arrow above the output folds it away. |
| ` ```srl terminal=srl1 ` | **Send** opens the node's shell, or uses the one already open, and types the lines into it. |

The rest is plain Markdown, and other tools show these attributes as part of an ordinary code block. A guide reads the same on GitHub and in an editor preview.

A block can sit in a list item, indented as far as the item's text. Links named by reference, `[the docs][clab]` with `[clab]: https://containerlab.dev` anywhere in the file, work in every step, also for nodes: `[r1]: node:srl1`.

Text is shown as you wrote it. Emoji shortcodes such as `:rocket:` and smart punctuation are left alone, so `2001:db8:a:b::1`, `00:de:ad:be:ef:00` and `--force` keep their characters. Type an emoji itself to show one.

### Exec or terminal

`containerlab exec` runs one command without a shell. An `exec=` block therefore holds one command; end a line with `\` to continue it on the next. Pipes, redirects and `&&` need a shell of their own:

```sh exec=srl1
sh -c 'ip -br addr | grep ethernet'
```

Use `terminal=` for interactive CLIs and for several commands in a row, such as entering configuration mode, changing the configuration and committing. The lines are typed one at a time. In web and desktop the first line waits until the terminal has printed something and each line waits until it has gone quiet, so a CLI that is still starting doesn't lose them. VS Code can't see what a terminal prints, so a shell it has just opened gets three seconds to start, and lines go out 300 ms apart.

The lines only ever go to the node's shell. When that shell has ended, **Send** opens a new one for them. In VS Code, the terminal **Attach Shell** opens is the node's shell and nothing else: it closes when the shell ends, so no line of a guide is typed into a shell on your own computer. A terminal of the same name that Attach Shell did not open gets nothing typed into it.

An `exec=` block waits for its command to end, then shows the output; it has no Stop button. Give commands an end, such as `ping -c 3` or `timeout 10 …`. A command that never ends shows "Running" until the app gives up after 10 minutes, and keeps running on the node afterwards. Put commands you want to watch, like a ping while you change the configuration, in a `terminal=` block as its last line, and stop them with Ctrl+C:

```sh terminal=srl1
ip netns exec srbase-default ping 192.168.0.2
```

Both kinds of block run in the node's container. `exec=` runs its command there, and `terminal=` types into the node's shell: the CLI for SR Linux, Cisco XRd and FRR, and `sh` for other kinds. In VS Code, the `containerlab.node.execCommandMapping` setting changes it. Routers that run as a VM inside their container, such as the vrnetlab kinds, and Cisco IOL have their CLI behind SSH instead: give their commands as copy blocks.

A run shows what each node printed, its errors included, without exit codes: what those mean differs from one OS to the next, and many CLIs report an error and still exit 0.

## Following a guide

Commands run on a deployed lab. Until the lab runs, the run buttons say so and the guide offers **Deploy**.

Every block has a checkmark. It ticks itself when a run finishes, even when the command failed, since a failing command can be part of the lesson. Click it to tick or untick a block yourself, for instance after running a command somewhere else. A step is done when all its blocks are.

Your step and checkmarks are kept for this lab and guide, so you can close the lab and come back to them. They stay on this computer and aren't shared with anyone.

The pencil in the panel header opens the guide file in your editor. The guide reloads when the file changes in VS Code; elsewhere, use the reload button next to it.

## Trust

A guide's commands run with your access to the lab, and whoever wrote the lab wrote them. Read a block before you run it.

The first time each block runs, the guide asks first, and names the nodes. Tick **Don't ask again for this guide** there to run the guide's other blocks without asking too, once you have read them. Only the blocks as they are then count: a block that changes later asks again.

Guides follow the [script buttons](script-buttons.md#trust) setting, except that **Only scripts from others** asks the first time too, since a guide is usually someone else's:

| Setting | A guide block asks |
| --- | --- |
| **First run of each script** (default) | The first time it runs, unless you agreed to the whole guide. A changed block asks again. |
| **Every run** | Before every run. **Don't ask again for this guide** isn't offered. |
| **Only scripts from others** | The first time it runs, unless you agreed to the whole guide. |

A page served over plain HTTP can't fingerprint a block to remember it, so there every block asks before every run.
