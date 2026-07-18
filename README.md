## Prompt Management System

This module provides a robust, REST-like API for generating, storing, searching, and managing both generated prompts and reusable prompt templates.

### Integration & Setup

To integrate this functionality into the existing single-repo WordPress plugin architecture, place the provided PHP files under your `/includes/modules` directory so they are automatically loaded via `loader.php`.

**Database Tables Required:**
Ensure the following tables exist within your database (using the environment-specific prefix):

* `wp_3vi5eiq2la_prompts`: Stores generated prompts. Designed to handle columns for `type`, `title`, `generated_prompt`, `prompt_data`, and timestamps (e.g., `created_at`, `deleted_at`).
* `wp_3vi5eiq2la_prompt_templates`: Stores reusable templates. Designed to handle columns for `category`, `key`, `label`, `payload`, `is_active`, `sort_order`, and `version`.

---

### File Overview & Endpoints

| File / Component | Description |
| --- | --- |
| `agent_prompt_utils.php` | Utility functions that generate the comprehensive "Agent Mode" research prompt and push it to the save endpoint via HTTP using cURL.

 |
| `clear_all_prompts.php` | Clears all entries from the `prompts` table with a secure `DELETE` query wrapped in a database transaction.

 |
| `delete_prompt.php` | Deletes a single prompt by its integer `id` using a prepared statement with a `LIMIT 1` guard.

 |
| `save_prompt.php` | Validates and inserts new prompts. It enforces a 1MB payload limit and restricts types to specific categories like `agent`, `design`, `code`, and `ptcf`.

 |
| `search_prompts.php` | Searches prompts with pagination, sorting, and dynamic fallback between `FULLTEXT` boolean matching and `LIKE` queries based on available indexes.

 |
| Template Deletion | Soft-deletes prompt templates by setting `is_active=0`, locating records by `id` or a `category` and `key` combination.

 |
| Template Retrieval | Fetches a single prompt template by its `id` or `key`/`category` combination and decodes its JSON payload.

 |
| Template Listing | Returns a list of all active (`is_active=1`) templates for a given category, properly ordered by `sort_order` and `label`.

 |
| Template Upsert | Inserts or updates templates using `ON DUPLICATE KEY UPDATE` to maintain keys, versions, and payload configurations without creating duplicates.

 |

---

### Security & Performance Guidelines

* **Method Restrictions:** Modifying endpoints strictly require `POST` requests and enforce no-cache headers to prevent stale operations and accidental data destruction.


* **Data Validation:** Endpoints ensure required JSON payloads are present, properly decoded, and validate input types (e.g., ensuring `id` is a positive integer) before executing queries.


* **Error Logging:** To maintain time-based outputs synced to the Australia/Brisbane timezone, replace the standard `error_log` calls found within `catch` blocks with the custom logger. Always format these calls as `oia_log_aest($message, 'error', ['key' => 'value'])`.
