# Watchman Command Build Log

## Discovery Session 1

**Date:** 2026-07-24

### Application Startup Files

- admin/start/routes.ts
- admin/start/kernel.ts
- admin/start/env.ts

### Purpose

These files control:

- Application routes
- Middleware
- Environment configuration

### Status

No modifications have been made.

This session was strictly for discovery and documentation.

## Discovery Session 3

### Ollama Service

File:
admin/app/services/ollama_service.ts

Purpose:
- Connects to Ollama
- Checks installed models
- Downloads AI models
- Tracks download progress
- Handles AI service errors

Status:
Discovery only.
No modifications made.

## Discovery Session 4

### Data Models

Folder:
admin/app/models

Important models discovered:
- chat_session.ts
- chat_message.ts
- kb_ingest_state.ts
- collection_manifest.ts
- installed_resource.ts
- wikipedia_selection.ts
- custom_library_source.ts
- kv_store.ts
- map_marker.ts

Purpose:
The application already separates chat, knowledge base, maps, resources, and configuration into individual models.

Status:
Discovery only.
No modifications made.
