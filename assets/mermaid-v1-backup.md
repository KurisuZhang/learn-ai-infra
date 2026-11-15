# mermaid 图改版前的原始代码（备份，可直接粘贴回原文还原）

> 生成时间 2026-11-15 · 三张图的原版都在这里。改版后的版本见 AI-Infra-学习手册与路线图.md。
> 原版问题：宽度分别是 3304 / 5440 / 1076 px，在 Obsidian 700px 正文栏里被等比压缩到 0.21× / 0.13× / 0.65×，字号只剩 3.4 / 2.1 / 10.4 px。

## 2.1 图 A：推理生命周期主链（原版）

```mermaid
flowchart LR
    A["Prompt 到达"] --> B["Tokenize"]
    B --> C["Prefill<br/>算力密集 compute-bound"]
    C --> D["KV Cache 写入<br/>按 block 分页"]
    D --> E["首 token 返回<br/>TTFT"]
    E --> F["Decode 单步<br/>带宽密集 memory-bound"]
    F --> G["Sampling<br/>greedy / top-k / top-p"]
    G --> H["Detokenize / 流式返回"]
    H --> I{"结束?"}
    I -->|否| F
    I -->|是| J["释放 / 保留 KV<br/>SLO 结算"]

    C -.->|"瓶颈①算力利用率"| K1["GEMM 效率 / Chunked Prefill"]
    F -.->|"瓶颈②HBM 带宽"| K2["权重复用 / 批内复用 / 量化"]
    D -.->|"瓶颈③显存容量"| K3["PagedAttention / Prefix Cache / KV 量化"]
    J -.->|"瓶颈④尾延迟"| K4["调度公平性 / PD 分离 / 路由"]
```

## 2.2 图 A′：推理知识地图（原版）

```mermaid
flowchart TB
    ROOT["大模型推理系统"]

    ROOT --> L1["① 负载层<br/>请求长什么样"]
    ROOT --> L2["② 内存层<br/>状态放在哪里"]
    ROOT --> L3["③ 执行层<br/>算子怎么算得快"]
    ROOT --> L4["④ 分布层<br/>多卡多机怎么协作"]

    L1 --> L1a["Prefill / Decode 两阶段"]
    L1 --> L1b["TTFT / TPOT / 吞吐 / goodput"]
    L1 --> L1c["请求到达分布与 SLO"]
    L1 --> L1d["多轮 / Agent / 长上下文负载"]

    L2 --> L2a["KV Cache 容量账本"]
    L2 --> L2b["PagedAttention 分页管理"]
    L2 --> L2c["Prefix Cache / RadixAttention"]
    L2 --> L2d["KV 量化 / 驱逐 / 卸载"]
    L2 --> L2e["权重量化 W8A8 / INT4 / FP8"]

    L3 --> L3a["Continuous Batching"]
    L3 --> L3b["Chunked Prefill 与 Token Budget"]
    L3 --> L3c["抢占 / 换出 / 重算"]
    L3 --> L3d["算子融合 / CUDA Graph"]
    L3 --> L3e["FlashAttention / Decode Attention"]
    L3 --> L3f["投机解码与 MTP"]

    L4 --> L4a["TP 张量并行"]
    L4 --> L4b["PP 流水并行"]
    L4 --> L4c["EP 专家并行 All-to-All"]
    L4 --> L4d["PD 分离与 KV 传输"]
    L4 --> L4e["路由 / 负载均衡 / 容量规划"]
```

## 2.3 图 B：训练框架树（原版）

```mermaid
flowchart TB
    DATA["数据管线<br/>清洗 / 去重 / 配比 / tokenize"] --> FWD["前向 Forward"]
    FWD --> LOSS["损失 Loss<br/>下一 token 交叉熵"]
    LOSS --> BWD["反向 Backward"]
    BWD --> OPT["优化器 step<br/>AdamW"]
    OPT --> UPD["参数更新"]
    UPD --> FWD

    FWD --> ACT["激活值 ACT<br/>正比于 batch × seq × layers"]
    BWD --> GRAD["梯度 GRAD<br/>与参数同大小"]
    OPT --> STATE["优化器状态<br/>FP32 主权重 + m + v"]

    ACT -.-> CKPT["激活重计算<br/>用时间换显存"]
    GRAD -.-> ZERO["ZeRO-1 / 2 / 3<br/>用通信换显存"]
    STATE -.-> ZERO
    UPD -.-> TP["TP 切矩阵"]
    UPD -.-> PP["PP 切层"]

    CKPT -.->|"推理侧对应：不存激活，改存 KV"| KV["KV Cache"]
    TP -.->|"同一套切分，推理侧继续用"| INFTP["推理 TP"]
    PP -.->|"推理侧改微批为请求级流水"| INFPP["推理 PP"]
    ZERO -.->|"推理侧无优化器状态，显存全给权重与 KV"| LEDGER["推理显存账本"]
```
