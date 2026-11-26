---
title: Two SR Linux routers, one link
duration: 15m
---

Bring up the link between [srl1](node:srl1) and [srl2](node:srl2), then prove it
carries traffic. The lab is [srl-pair.clab.yml](srl-pair.clab.yml).

## Meet the routers

Both nodes run SR Linux. Ask each one for its version:

```sh exec=srl1,srl2
sr_cli "show version"
```

Each node has `ethernet-1/1` wired to its peer, but nothing is configured on
it yet, not even the `default` network instance. Try to reach srl2 from srl1:
the ping fails with "Cannot open network namespace".

```sh exec=srl1
ip netns exec srbase-default ping -c 3 192.168.0.2
```

## Configure the link

Open the CLI on [srl1](node:srl1) and enter the configuration:

```srl terminal=srl1
enter candidate
set / interface ethernet-1/1 admin-state enable
set / interface ethernet-1/1 subinterface 0 ipv4 admin-state enable
set / interface ethernet-1/1 subinterface 0 ipv4 address 192.168.0.1/30
set / network-instance default interface ethernet-1/1.0
commit now
```

Do the same on [srl2](node:srl2) with the other address:

```srl terminal=srl2
enter candidate
set / interface ethernet-1/1 admin-state enable
set / interface ethernet-1/1 subinterface 0 ipv4 admin-state enable
set / interface ethernet-1/1 subinterface 0 ipv4 address 192.168.0.2/30
set / network-instance default interface ethernet-1/1.0
commit now
```

## Ping across

Run the same ping as before. With both ends configured, it gets through:

```sh exec=srl1
ip netns exec srbase-default ping -c 3 192.168.0.2
```
