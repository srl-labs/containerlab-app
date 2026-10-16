---
description: Work on the same labs with everyone signed in to one lab host.
---

# Shared labs

A lab host can have one folder that belongs to everyone. Anyone signed in to that host can open, edit, deploy, and destroy the labs in it.
{ .lead }

<figure class="diagram" markdown>

```clab file="diagrams/shared-labs.clab.yml" annotations="diagrams/shared-labs.clab.yml.annotations.json" title="Personal and shared labs on one lab host" height="320" borderless="true" zoom="false" fit-padding="0.1"
```

<figcaption>Alice and Bob each keep personal labs. Both work on the labs in the shared folder.</figcaption>
</figure>

Shared labs are a desktop and web app feature. An administrator turns them on once with [`CLAB_SHARED_LABS_ROOT`](../reference/api-server.md#shared-labs).

## Create a shared lab

When you create a topology, choose **Shared** under **Location** and give it a normal file name like `my-lab.clab.yml`. Starting from the **Shared labs** folder in the explorer selects **Shared** for you.

You can also create subfolders and upload files from the folder's menu.

## What is shared

| Shared | Personal |
| --- | --- |
| The topology and annotation files | Terminal sessions |
| Deploying, applying, and destroying | Packet captures |
| Seeing and operating the running lab | Your personal labs and templates |

Shared labs carry a **Shared** badge in the explorer and stay visible when you hide other users' labs. A running lab shows who deployed it.

## Editing together

When someone else saves the file you have open, your canvas updates. If you save on top of a change you have not seen yet, the save is refused and your text stays in the editor, so you can copy it before you reload.

## Good to know

- Destroying a shared lab keeps its files for the next person.
- Deleting a shared file or folder deletes it for everyone.
- The **Shared labs** folder itself cannot be renamed or deleted.
- Files cannot be moved between personal and shared.
- Everyone on the host has access. There are no per-group permissions.

<div class="next" markdown>
[:lucide-arrow-right: Set up a lab host](../install/lab-host.md)
[:lucide-arrow-right: Run a lab](labs.md)
</div>
