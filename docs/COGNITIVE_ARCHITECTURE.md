# Cognitive Architecture Notes

This document describes the **long-term cognitive architecture** envisioned for the system code-named **“The Junior”**.

It is **not a roadmap**, **not a feature list**, and **not a commitment**.
It documents architectural intent, design principles, and boundaries.

The goal is to describe *how* the system should think and adapt over time,
not *when* specific components will be implemented.

---

## Scope and Intent

Search API is only one component of a larger local AI system.

This document focuses on:
- memory models,
- adaptation and personalization,
- control boundaries between user and model,
- long-term evolution from tool to partner.

It intentionally avoids:
- versioning,
- deadlines,
- implementation details tied to specific releases.

---

## Core Design Goal

Transform the LLM from a **stateless reasoning tool** into a **long-term working partner**,
without sacrificing:
- user control,
- transparency,
- predictability,
- safety.

This requires **memory**, but not all memory is the same.

---

## Memory Model Overview

The architecture distinguishes **two fundamentally different types of memory**:

1. **Explicit, user-approved memory**
2. **Implicit, adaptive (behavioral) memory**

They serve different purposes and follow different rules.

---

## 1. Explicit User-Approved Memory

### Purpose

Store **facts and decisions** that must persist across:
- sessions,
- chats,
- branches,
- projects.

This memory exists to prevent the system from “starting from zero” every time.

---

### Key properties

- Written **only with explicit user consent**
- User decides *what* is stored
- User can:
  - review entries,
  - edit them,
  - delete them,
  - disable the memory entirely

The model has **no autonomous write access** to this memory.

---

### Typical contents

- architectural decisions,
- long-term project context,
- stable user preferences,
- agreed rules and constraints,
- “this is important, do not forget” statements.

This memory represents **shared ground truth** between user and system.

---

### Architectural notes

- Implemented as a dedicated RAG-backed storage
- Entries are explicit and inspectable
- No hidden inference or interpretation

This is **controlled memory**.

---

## 2. Implicit Adaptive Memory (Personalization Layer)

### Purpose

Allow the system to **adapt its behavior** over time.

This memory is not about *facts*.
It is about *how to work with the user*.

---

### What this memory captures

- preferred communication style,
- tolerance for verbosity,
- expectations about rigor vs speed,
- sensitivity to speculation,
- reaction to uncertainty,
- workflow habits.

In short: **interaction patterns**, not personal data.

---

### Key differences from explicit memory

| Explicit Memory | Adaptive Memory |
|-----------------|-----------------|
| User-approved writes | Model-inferred writes |
| Stores facts | Stores behavioral patterns |
| Fully inspectable | May be summarized or abstract |
| RAG-backed | Cognitive / profile layer |
| “Remember this” | “I learned how to work with you” |

---

### How it should behave

- Gradual adaptation, not sudden changes
- Aggregated observations, not raw logs
- No storage of sensitive or personal data
- No psychological profiling

This layer should feel like **familiarity**, not surveillance.

---

### Control principles

The user must be able to:
- disable adaptive memory,
- reset it,
- freeze it.

Adaptive behavior must never override explicit user instructions.

---

## Relationship Between Memory Types

The two memory types are **strictly separated**.

- Explicit memory defines *what is true*
- Adaptive memory defines *how to interact*

Adaptive memory must never:
- contradict explicit memory,
- invent facts,
- silently influence factual reasoning.

---

## Role of RAG in the System

RAG is treated as a **knowledge retrieval layer**, not as cognition.

Planned RAG domains include:
- web search cache,
- filesystem documents,
- codebases,
- long-term explicit memory.

Adaptive memory is **not a RAG domain**.

---

## Orchestrator Layer

A future orchestrator component is expected to:
- coordinate LLM calls,
- manage memory access,
- enforce boundaries,
- control reasoning loops.

The orchestrator is responsible for:
- deciding *when* memory is read,
- deciding *which* memory is relevant,
- preventing uncontrolled feedback loops.

---

## External Reasoning Loop

An optional external reasoning loop may be introduced in the future.

Its purpose:
- self-verification,
- error detection,
- iterative refinement.

This loop is intentionally external to the model to:
- maintain observability,
- allow strict limits,
- avoid opaque internal chains.

---

## Ethical and Safety Boundaries

The system must avoid:
- covert data collection,
- hidden long-term profiling,
- emotional manipulation,
- dependency reinforcement.

The goal is **competent partnership**, not attachment.

---

## Design Philosophy

The Junior is not designed to be:
- magical,
- omniscient,
- autonomous without limits.

It is designed to be:
- explicit,
- inspectable,
- adaptable,
- respectful of user agency.

Memory is a tool — not a substitute for control.

---

## Closing Notes

This document captures **intent**, not obligation.

Implementation order, scope, and timing are expected to evolve.
The principles described here are meant to guide that evolution,
not constrain it prematurely.
