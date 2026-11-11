import type { McpToolDescriptor } from "../tool-access/catalog/descriptors.js";

/**
 * Tool catalog of gitea-mcp v1.13.0 (gitea.com/gitea/gitea-mcp), captured from its
 * `tools/list` response. Used by the approved `paperclip.gitea-mcp` stdio template so the
 * catalog is reviewable before any process runs. Refresh it when the pinned version changes.
 */
export const GITEA_MCP_VERSION = "v1.13.0";

export const GITEA_MCP_TOOLS: McpToolDescriptor[] = [
 {
  "name": "actions_config_read",
  "description": "Read Actions secrets and variables.",
  "inputSchema": {
   "properties": {
    "method": {
     "enum": [
      "list_repo_secrets",
      "list_org_secrets",
      "list_repo_variables",
      "get_repo_variable",
      "list_org_variables",
      "get_org_variable"
     ],
     "type": "string"
    },
    "name": {
     "description": "for get methods",
     "type": "string"
    },
    "org": {
     "description": "for org methods",
     "type": "string"
    },
    "owner": {
     "description": "for repo methods",
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "minimum": 1,
     "type": "number"
    },
    "repo": {
     "description": "for repo methods",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read Actions secrets and variables"
  }
 },
 {
  "name": "actions_config_write",
  "description": "Write Actions secrets and variables.",
  "inputSchema": {
   "properties": {
    "data": {
     "description": "secret value (upsert)",
     "type": "string"
    },
    "description": {
     "description": "for secrets and org variables",
     "type": "string"
    },
    "method": {
     "enum": [
      "upsert_repo_secret",
      "delete_repo_secret",
      "upsert_org_secret",
      "delete_org_secret",
      "create_repo_variable",
      "update_repo_variable",
      "delete_repo_variable",
      "create_org_variable",
      "update_org_variable",
      "delete_org_variable"
     ],
     "type": "string"
    },
    "name": {
     "description": "secret or variable name",
     "type": "string"
    },
    "org": {
     "description": "for org methods",
     "type": "string"
    },
    "owner": {
     "description": "for repo methods",
     "type": "string"
    },
    "repo": {
     "description": "for repo methods",
     "type": "string"
    },
    "value": {
     "description": "variable value",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Manage Actions secrets and variables"
  }
 },
 {
  "name": "actions_run_read",
  "description": "Read Actions workflows, runs, jobs, logs and artifacts.",
  "inputSchema": {
   "properties": {
    "artifact_id": {
     "description": "for 'get_artifact'/'download_artifact'",
     "type": "number"
    },
    "artifact_name": {
     "description": "name filter for 'list_artifacts'/'list_run_artifacts'",
     "type": "string"
    },
    "branch": {
     "description": "filter for 'list_runs'",
     "type": "string"
    },
    "context_lines": {
     "default": 2,
     "description": "for 'get_job_log_preview': lines kept around each 'pattern' match",
     "minimum": 0,
     "type": "number"
    },
    "head_sha": {
     "description": "full SHA filter for 'list_runs'",
     "type": "string"
    },
    "job_id": {
     "description": "for 'get_job'/log methods",
     "type": "number"
    },
    "max_bytes": {
     "default": 65536,
     "description": "max log bytes",
     "minimum": 1024,
     "type": "number"
    },
    "method": {
     "enum": [
      "list_workflows",
      "get_workflow",
      "list_runs",
      "get_run",
      "list_jobs",
      "list_run_jobs",
      "get_job",
      "get_job_log_preview",
      "download_job_log",
      "list_artifacts",
      "list_run_artifacts",
      "get_artifact",
      "download_artifact"
     ],
     "type": "string"
    },
    "offset": {
     "description": "for 'get_job_log_preview': byte to start from, rounded down to a line start. Pass a previous result's 'bytes' to get only lines added since. Before Gitea 1.27 a rerun keeps the job_id and restarts its log, so start over at 0",
     "minimum": 0,
     "type": "number"
    },
    "output_path": {
     "description": "for 'download_job_log'/'download_artifact'",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "pattern": {
     "description": "for 'get_job_log_preview': RE2 regexp, keep only matching log lines (each starts with a timestamp), e.g. '::error::|FAIL'",
     "type": "string"
    },
    "per_page": {
     "default": 30,
     "minimum": 1,
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "run_id": {
     "description": "for 'get_run'/'list_run_jobs'/'list_run_artifacts'",
     "type": "number"
    },
    "status": {
     "description": "filter for 'list_runs'/'list_jobs'",
     "type": "string"
    },
    "tail_lines": {
     "default": 200,
     "description": "log tail lines",
     "minimum": 1,
     "type": "number"
    },
    "workflow_id": {
     "description": "ID or filename (for 'get_workflow')",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read Actions workflow, run, job, and artifact data"
  }
 },
 {
  "name": "actions_run_write",
  "description": "Dispatch, cancel, delete, rerun or approve Actions runs, enable or disable workflows.",
  "inputSchema": {
   "properties": {
    "inputs": {
     "description": "for 'dispatch_workflow'",
     "properties": {},
     "type": "object"
    },
    "job_id": {
     "description": "for 'rerun_job'",
     "type": "number"
    },
    "method": {
     "enum": [
      "dispatch_workflow",
      "cancel_run",
      "delete_run",
      "rerun_run",
      "rerun_job",
      "rerun_failed_jobs",
      "approve_run",
      "enable_workflow",
      "disable_workflow"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "ref": {
     "description": "branch or tag (for 'dispatch_workflow')",
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "run_id": {
     "description": "required except for workflow methods",
     "type": "number"
    },
    "workflow_id": {
     "description": "ID or filename (for 'dispatch_workflow'/'enable_workflow'/'disable_workflow')",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Trigger, cancel, delete, rerun, or approve Actions workflows"
  }
 },
 {
  "name": "branch_read",
  "description": "Read branches.",
  "inputSchema": {
   "properties": {
    "branch": {
     "description": "required for 'get'",
     "type": "string"
    },
    "method": {
     "enum": [
      "list",
      "get"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read branches"
  }
 },
 {
  "name": "branch_write",
  "description": "Create, delete or rename branches.",
  "inputSchema": {
   "properties": {
    "branch": {
     "description": "required for 'create', 'delete', 'rename'",
     "type": "string"
    },
    "method": {
     "enum": [
      "create",
      "delete",
      "rename"
     ],
     "type": "string"
    },
    "new_name": {
     "description": "required for 'rename'",
     "type": "string"
    },
    "old_branch": {
     "description": "source for 'create' (default: repo default)",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "repo": {
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Create, delete, or rename branches"
  }
 },
 {
  "name": "commit_read",
  "description": "Read commits with optional diff, combined statuses, and compare refs.",
  "inputSchema": {
   "properties": {
    "base": {
     "description": "branch, tag or SHA, required for 'compare'",
     "type": "string"
    },
    "head": {
     "description": "branch, tag or SHA, required for 'compare'",
     "type": "string"
    },
    "include_diff": {
     "description": "include unified diff for 'get'",
     "type": "boolean"
    },
    "method": {
     "enum": [
      "list",
      "get",
      "get_status",
      "compare"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "path": {
     "description": "only commits touching this path for 'list'",
     "type": "string"
    },
    "per_page": {
     "default": 30,
     "minimum": 1,
     "type": "number"
    },
    "ref": {
     "description": "SHA, branch or tag, required for 'get_status'",
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "sha": {
     "description": "required for 'get', optional starting SHA or branch for 'list'",
     "type": "string"
    },
    "wait_seconds": {
     "description": "for 'get_status': seconds to wait while pending, max 45",
     "type": "number"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read commits"
  }
 },
 {
  "name": "commit_write",
  "description": "Create a commit status.",
  "inputSchema": {
   "properties": {
    "context": {
     "description": "check name, e.g. 'ci/build'",
     "type": "string"
    },
    "description": {
     "type": "string"
    },
    "method": {
     "enum": [
      "create_status"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "sha": {
     "description": "required for 'create_status'",
     "type": "string"
    },
    "state": {
     "description": "required for 'create_status'",
     "enum": [
      "pending",
      "success",
      "error",
      "failure",
      "warning"
     ],
     "type": "string"
    },
    "target_url": {
     "description": "link to details",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Create a commit status"
  }
 },
 {
  "name": "create_or_update_file",
  "description": "Create, update, rename or delete files in one commit.",
  "inputSchema": {
   "properties": {
    "branch_name": {
     "description": "branch to commit to",
     "type": "string"
    },
    "content": {
     "description": "literal file text, not base64",
     "type": "string"
    },
    "edits": {
     "items": {
      "additionalProperties": false,
      "properties": {
       "new_string": {
        "type": "string"
       },
       "old_string": {
        "type": "string"
       },
       "replace_all": {
        "type": "boolean"
       }
      },
      "required": [
       "old_string",
       "new_string"
      ],
      "type": "object"
     },
     "type": "array"
    },
    "files": {
     "items": {
      "additionalProperties": false,
      "properties": {
       "content": {
        "description": "literal file text, not base64",
        "type": "string"
       },
       "delete": {
        "type": "boolean"
       },
       "edits": {
        "items": {
         "additionalProperties": false,
         "properties": {
          "new_string": {
           "type": "string"
          },
          "old_string": {
           "type": "string"
          },
          "replace_all": {
           "type": "boolean"
          }
         },
         "required": [
          "old_string",
          "new_string"
         ],
         "type": "object"
        },
        "type": "array"
       },
       "from_path": {
        "description": "rename source",
        "type": "string"
       },
       "path": {
        "description": "path relative to repo root",
        "type": "string"
       },
       "sha": {
        "description": "existing file SHA, of from_path when renaming (omit to create)",
        "type": "string"
       }
      },
      "required": [
       "path"
      ],
      "type": "object"
     },
     "type": "array"
    },
    "message": {
     "description": "commit message",
     "type": "string"
    },
    "new_branch_name": {
     "description": "branch to create from branch_name and commit to",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "path": {
     "description": "path relative to repo root",
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "sha": {
     "description": "existing file SHA (omit to create)",
     "type": "string"
    }
   },
   "required": [
    "owner",
    "repo",
    "message",
    "branch_name"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Create, update, rename, or delete files"
  }
 },
 {
  "name": "create_organization",
  "description": "Create an organization.",
  "inputSchema": {
   "properties": {
    "description": {
     "type": "string"
    },
    "full_name": {
     "type": "string"
    },
    "username": {
     "description": "organization name",
     "type": "string"
    },
    "visibility": {
     "default": "public",
     "enum": [
      "public",
      "limited",
      "private"
     ],
     "type": "string"
    },
    "website": {
     "type": "string"
    }
   },
   "required": [
    "username"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Create an organization"
  }
 },
 {
  "name": "delete_file",
  "description": "Delete a file in a new commit.",
  "inputSchema": {
   "properties": {
    "branch_name": {
     "description": "branch to commit to",
     "type": "string"
    },
    "message": {
     "description": "commit message",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "path": {
     "description": "path relative to repo root",
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "sha": {
     "description": "existing file SHA",
     "type": "string"
    }
   },
   "required": [
    "owner",
    "repo",
    "path",
    "message",
    "branch_name",
    "sha"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Delete a file"
  }
 },
 {
  "name": "get_dir_contents",
  "description": "List a repository directory.",
  "inputSchema": {
   "properties": {
    "owner": {
     "type": "string"
    },
    "path": {
     "description": "path relative to repo root",
     "type": "string"
    },
    "ref": {
     "description": "branch, tag, or commit SHA",
     "type": "string"
    },
    "repo": {
     "type": "string"
    }
   },
   "required": [
    "owner",
    "repo",
    "ref",
    "path"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Get directory contents"
  }
 },
 {
  "name": "get_file_contents",
  "description": "Get a file or list a directory.",
  "inputSchema": {
   "properties": {
    "end_line": {
     "minimum": 1,
     "type": "number"
    },
    "owner": {
     "type": "string"
    },
    "path": {
     "default": "/",
     "description": "path relative to repo root",
     "type": "string"
    },
    "ref": {
     "description": "branch, tag, or commit SHA, defaults to the default branch",
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "sha": {
     "description": "commit SHA, overrides ref",
     "type": "string"
    },
    "start_line": {
     "minimum": 1,
     "type": "number"
    },
    "with_lines": {
     "description": "return numbered lines",
     "type": "boolean"
    }
   },
   "required": [
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Get file or directory contents"
  }
 },
 {
  "name": "get_gitea_mcp_server_version",
  "description": "Get this MCP server's version, not Gitea's.",
  "inputSchema": {
   "properties": {},
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Get server version"
  }
 },
 {
  "name": "get_me",
  "description": "Get the authenticated user.",
  "inputSchema": {
   "properties": {},
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Get current user information"
  }
 },
 {
  "name": "get_repository_tree",
  "description": "Get a repository's file tree.",
  "inputSchema": {
   "properties": {
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "recursive": {
     "type": "boolean"
    },
    "repo": {
     "type": "string"
    },
    "tree_sha": {
     "description": "SHA, branch, or tag",
     "type": "string"
    }
   },
   "required": [
    "owner",
    "repo",
    "tree_sha"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Get repository file tree"
  }
 },
 {
  "name": "get_user_orgs",
  "description": "List your organizations.",
  "inputSchema": {
   "properties": {
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    }
   },
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Get user organizations"
  }
 },
 {
  "name": "issue_read",
  "description": "Read an issue with its comments, labels, dependencies, assignee candidates and attachments.",
  "inputSchema": {
   "properties": {
    "attachment_id": {
     "description": "required for get_attachment, or download_attachment without attachment_uuid",
     "type": "number"
    },
    "attachment_uuid": {
     "description": "for download_attachment",
     "type": "string"
    },
    "comment_id": {
     "description": "required for get_comment, or scopes comment attachments",
     "type": "number"
    },
    "issue_number": {
     "description": "required except for get_comment, get_assignee_candidates, comment attachments or download_attachment with attachment_uuid",
     "type": "number"
    },
    "method": {
     "enum": [
      "get",
      "get_comments",
      "get_comment",
      "get_labels",
      "get_blocked_by",
      "get_blocking",
      "get_assignee_candidates",
      "get_attachments",
      "get_attachment",
      "download_attachment"
     ],
     "type": "string"
    },
    "output_path": {
     "description": "exact download destination",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read issue details"
  }
 },
 {
  "name": "issue_write",
  "description": "Write issues, comments, labels, dependencies and attachments.",
  "inputSchema": {
   "properties": {
    "assignees": {
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "attachment_id": {
     "description": "required for delete_attachment",
     "type": "number"
    },
    "body": {
     "description": "required for 'add_comment'/'update_comment'",
     "type": "string"
    },
    "comment_id": {
     "description": "required for update_comment/delete_comment, or scopes comment attachments",
     "type": "number"
    },
    "content": {
     "description": "base64 file content for add_attachment",
     "type": "string"
    },
    "deadline": {
     "description": "ISO 8601",
     "type": "string"
    },
    "dependency_type": {
     "description": "issue_number is blocked_by or blocking the related issue",
     "enum": [
      "blocked_by",
      "blocking"
     ],
     "type": "string"
    },
    "issue_number": {
     "description": "required except for create, update_comment, delete_comment or comment attachments",
     "type": "number"
    },
    "label_id": {
     "description": "label name or ID (for 'remove_label')",
     "type": "string"
    },
    "labels": {
     "description": "label names or IDs",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "method": {
     "enum": [
      "create",
      "update",
      "add_comment",
      "update_comment",
      "delete_comment",
      "add_labels",
      "remove_label",
      "replace_labels",
      "clear_labels",
      "add_dependency",
      "remove_dependency",
      "add_attachment",
      "delete_attachment"
     ],
     "type": "string"
    },
    "milestone": {
     "type": "number"
    },
    "name": {
     "description": "file name for add_attachment",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "ref": {
     "description": "branch to associate",
     "type": "string"
    },
    "related_issue_number": {
     "type": "number"
    },
    "related_owner": {
     "description": "defaults to owner",
     "type": "string"
    },
    "related_repo": {
     "description": "defaults to repo",
     "type": "string"
    },
    "remove_deadline": {
     "type": "boolean"
    },
    "repo": {
     "type": "string"
    },
    "state": {
     "enum": [
      "open",
      "closed",
      "all"
     ],
     "type": "string"
    },
    "title": {
     "description": "required for 'create'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Write issues, comments, labels, dependencies and attachments"
  }
 },
 {
  "name": "label_read",
  "description": "Read repo or org labels.",
  "inputSchema": {
   "properties": {
    "id": {
     "description": "label ID (for 'get_repo_label')",
     "type": "number"
    },
    "method": {
     "enum": [
      "list_repo_labels",
      "get_repo_label",
      "list_org_labels"
     ],
     "type": "string"
    },
    "org": {
     "description": "for org methods",
     "type": "string"
    },
    "owner": {
     "description": "for repo methods",
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "description": "for repo methods",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read labels"
  }
 },
 {
  "name": "label_write",
  "description": "Write repo or org labels.",
  "inputSchema": {
   "properties": {
    "color": {
     "description": "hex (#RRGGBB); required for create",
     "type": "string"
    },
    "description": {
     "type": "string"
    },
    "exclusive": {
     "description": "mutually exclusive with labels of the same scope, e.g. 'priority/'",
     "type": "boolean"
    },
    "id": {
     "description": "for edit/delete",
     "type": "number"
    },
    "is_archived": {
     "description": "archived (repo only)",
     "type": "boolean"
    },
    "method": {
     "enum": [
      "create_repo_label",
      "update_repo_label",
      "delete_repo_label",
      "create_org_label",
      "update_org_label",
      "delete_org_label"
     ],
     "type": "string"
    },
    "name": {
     "description": "required for create",
     "type": "string"
    },
    "org": {
     "description": "for org methods",
     "type": "string"
    },
    "owner": {
     "description": "for repo methods",
     "type": "string"
    },
    "repo": {
     "description": "for repo methods",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Create, update, or delete labels"
  }
 },
 {
  "name": "list_issues",
  "description": "List repository issues or pull requests, filterable by state, labels, milestones, users and update time.",
  "inputSchema": {
   "properties": {
    "assigned_by": {
     "description": "assignee username",
     "type": "string"
    },
    "before": {
     "description": "updated before ISO 8601",
     "type": "string"
    },
    "created_by": {
     "type": "string"
    },
    "labels": {
     "description": "label name filter",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "mentioned_by": {
     "description": "mentioned username",
     "type": "string"
    },
    "milestones": {
     "description": "milestone name or ID filter",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "since": {
     "description": "updated after ISO 8601",
     "type": "string"
    },
    "state": {
     "default": "all",
     "type": "string"
    },
    "type": {
     "description": "issues or pulls",
     "enum": [
      "issues",
      "pulls"
     ],
     "type": "string"
    }
   },
   "required": [
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "List repository issues"
  }
 },
 {
  "name": "list_pull_requests",
  "description": "List repository pull requests, filterable by state and milestone.",
  "inputSchema": {
   "properties": {
    "milestone": {
     "type": "number"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "sort": {
     "default": "recentupdate",
     "enum": [
      "oldest",
      "recentupdate",
      "leastupdate",
      "mostcomment",
      "leastcomment",
      "priority"
     ],
     "type": "string"
    },
    "state": {
     "default": "all",
     "enum": [
      "open",
      "closed",
      "all"
     ],
     "type": "string"
    }
   },
   "required": [
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "List pull requests"
  }
 },
 {
  "name": "milestone_read",
  "description": "Read milestones.",
  "inputSchema": {
   "properties": {
    "id": {
     "description": "for 'get'",
     "type": "number"
    },
    "method": {
     "enum": [
      "get",
      "list"
     ],
     "type": "string"
    },
    "name": {
     "description": "name filter (for 'list')",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "state": {
     "default": "all",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read milestones"
  }
 },
 {
  "name": "milestone_write",
  "description": "Write milestones.",
  "inputSchema": {
   "properties": {
    "description": {
     "type": "string"
    },
    "due_on": {
     "description": "due date",
     "type": "string"
    },
    "id": {
     "description": "for 'update'/'delete'",
     "type": "number"
    },
    "method": {
     "enum": [
      "create",
      "update",
      "delete"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "state": {
     "enum": [
      "open",
      "closed"
     ],
     "type": "string"
    },
    "title": {
     "description": "for 'create'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Create, update, or delete milestones"
  }
 },
 {
  "name": "notification_read",
  "description": "List notifications or get a thread.",
  "inputSchema": {
   "properties": {
    "before": {
     "description": "updated before ISO 8601",
     "type": "string"
    },
    "id": {
     "description": "thread ID (for 'get')",
     "type": "number"
    },
    "method": {
     "enum": [
      "list",
      "get"
     ],
     "type": "string"
    },
    "owner": {
     "description": "scope 'list' to a repo",
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "description": "scope 'list' to a repo",
     "type": "string"
    },
    "since": {
     "description": "updated after ISO 8601",
     "type": "string"
    },
    "status": {
     "enum": [
      "unread",
      "read",
      "pinned"
     ],
     "type": "string"
    },
    "subject_type": {
     "enum": [
      "Issue",
      "Pull",
      "Commit",
      "Repository"
     ],
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read notifications"
  }
 },
 {
  "name": "notification_write",
  "description": "Mark notifications as read.",
  "inputSchema": {
   "properties": {
    "id": {
     "description": "thread ID (for 'mark_read')",
     "type": "number"
    },
    "last_read_at": {
     "description": "ISO 8601; defaults to now",
     "type": "string"
    },
    "method": {
     "enum": [
      "mark_read",
      "mark_all_read"
     ],
     "type": "string"
    },
    "owner": {
     "description": "scope 'mark_all_read' to a repo",
     "type": "string"
    },
    "repo": {
     "description": "scope 'mark_all_read' to a repo",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Manage notifications"
  }
 },
 {
  "name": "package_read",
  "description": "Read the package registry, listing packages returns one entry per version.",
  "inputSchema": {
   "properties": {
    "method": {
     "enum": [
      "list",
      "list_versions",
      "get"
     ],
     "type": "string"
    },
    "name": {
     "description": "slashes auto-encoded; required except 'list'",
     "type": "string"
    },
    "owner": {
     "description": "user or org",
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "minimum": 1,
     "type": "number"
    },
    "q": {
     "description": "search query",
     "type": "string"
    },
    "type": {
     "description": "container/npm/maven/pypi/cargo/generic; required except 'list'",
     "type": "string"
    },
    "version": {
     "description": "for 'get'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read package registry"
  }
 },
 {
  "name": "package_write",
  "description": "Delete a package version (irreversible).",
  "inputSchema": {
   "properties": {
    "method": {
     "enum": [
      "delete"
     ],
     "type": "string"
    },
    "name": {
     "description": "slashes auto-encoded",
     "type": "string"
    },
    "owner": {
     "description": "user or org",
     "type": "string"
    },
    "type": {
     "description": "container/npm/maven/pypi/cargo/generic",
     "type": "string"
    },
    "version": {
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "type",
    "name",
    "version"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Delete a package version"
  }
 },
 {
  "name": "project_read",
  "description": "Read projects of owner+repo, org, or yours if neither.",
  "inputSchema": {
   "properties": {
    "column_id": {
     "type": "number"
    },
    "method": {
     "enum": [
      "list",
      "get",
      "list_columns",
      "list_column_issues"
     ],
     "type": "string"
    },
    "org": {
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "minimum": 1,
     "type": "number"
    },
    "project_id": {
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "state": {
     "default": "all",
     "enum": [
      "open",
      "closed",
      "all"
     ],
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read projects"
  }
 },
 {
  "name": "project_write",
  "description": "Write projects of owner+repo, org, or yours if neither. add_issue also moves columns, move_issue reorders within one.",
  "inputSchema": {
   "properties": {
    "color": {
     "description": "column color as 6-digit hex, e.g. #FF0000",
     "type": "string"
    },
    "column_id": {
     "type": "number"
    },
    "column_ids": {
     "description": "for 'move_columns': every column ID of the project, in the new order",
     "items": {
      "type": "number"
     },
     "type": "array"
    },
    "description": {
     "type": "string"
    },
    "issue_id": {
     "description": "issue id, not number",
     "type": "number"
    },
    "method": {
     "enum": [
      "create",
      "update",
      "delete",
      "create_column",
      "update_column",
      "delete_column",
      "move_columns",
      "set_default_column",
      "add_issue",
      "remove_issue",
      "move_issue"
     ],
     "type": "string"
    },
    "org": {
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "project_id": {
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "sorting": {
     "description": "'update_column': column position, -128 to 127; 'move_issue': position in the column, omit to append",
     "type": "number"
    },
    "state": {
     "enum": [
      "open",
      "closed"
     ],
     "type": "string"
    },
    "template_type": {
     "enum": [
      "none",
      "basic_kanban",
      "bug_triage"
     ],
     "type": "string"
    },
    "title": {
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Manage projects"
  }
 },
 {
  "name": "pull_request_read",
  "description": "Read a pull request with its diff, files, commits, status, reviews, inline review comments and discussion comments, list reviewer candidates, or find one by branches or commit.",
  "inputSchema": {
   "properties": {
    "base": {
     "description": "base branch (for 'get_by_branches')",
     "type": "string"
    },
    "binary": {
     "description": "include binary diff",
     "type": "boolean"
    },
    "head": {
     "description": "head branch (for 'get_by_branches')",
     "type": "string"
    },
    "method": {
     "enum": [
      "get",
      "get_diff",
      "get_files",
      "get_commits",
      "get_status",
      "get_reviews",
      "get_review",
      "get_review_comments",
      "get_comments",
      "get_by_branches",
      "get_by_commit",
      "get_reviewer_candidates"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "path": {
     "description": "for 'get_diff': only this file's diff",
     "type": "string"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "pull_number": {
     "description": "required except for 'get_by_branches'/'get_by_commit'/'get_reviewer_candidates'",
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "review_id": {
     "description": "for 'get_review'; optional for 'get_review_comments', omit to list all",
     "type": "number"
    },
    "sha": {
     "description": "commit SHA (for 'get_by_commit')",
     "type": "string"
    },
    "wait_seconds": {
     "description": "for 'get_status': seconds to wait while pending, max 45",
     "type": "number"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read pull request details"
  }
 },
 {
  "name": "pull_request_review_write",
  "description": "Create, submit, delete or dismiss pull request reviews, reply to and resolve review comments.",
  "inputSchema": {
   "properties": {
    "body": {
     "description": "review body, or reply text for 'reply_comment'",
     "type": "string"
    },
    "comment_id": {
     "description": "comment ID from 'get_review_comments'; resolve takes the thread's first",
     "type": "number"
    },
    "comments": {
     "description": "inline comments (for 'create')",
     "items": {
      "properties": {
       "body": {
        "type": "string"
       },
       "new_line_num": {
        "description": "new-file line (additions)",
        "type": "number"
       },
       "old_line_num": {
        "description": "old-file line (deletions)",
        "type": "number"
       },
       "path": {
        "type": "string"
       }
      },
      "type": "object"
     },
     "type": "array"
    },
    "commit_id": {
     "description": "for 'create'",
     "type": "string"
    },
    "message": {
     "description": "dismissal reason",
     "type": "string"
    },
    "method": {
     "enum": [
      "create",
      "submit",
      "delete",
      "dismiss",
      "reply_comment",
      "resolve_thread",
      "unresolve_thread"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "pull_number": {
     "description": "required except for 'resolve_thread'/'unresolve_thread'",
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "review_id": {
     "description": "for 'submit'/'delete'/'dismiss'",
     "type": "number"
    },
    "state": {
     "enum": [
      "APPROVED",
      "REQUEST_CHANGES",
      "COMMENT",
      "PENDING"
     ],
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Write pull request reviews"
  }
 },
 {
  "name": "pull_request_write",
  "description": "Create, update, merge, close or reopen pull requests, update their branch from base, manage reviewers.",
  "inputSchema": {
   "properties": {
    "allow_maintainer_edit": {
     "description": "for 'update'",
     "type": "boolean"
    },
    "assignee": {
     "description": "for 'create'/'update'",
     "type": "string"
    },
    "assignees": {
     "description": "for 'create'/'update'",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "base": {
     "description": "base branch (required for 'create')",
     "type": "string"
    },
    "body": {
     "type": "string"
    },
    "deadline": {
     "description": "ISO 8601",
     "type": "string"
    },
    "delete_branch": {
     "description": "for 'merge'",
     "type": "boolean"
    },
    "draft": {
     "description": "uses 'WIP: ' title prefix",
     "type": "boolean"
    },
    "force_merge": {
     "description": "merge even if checks fail",
     "type": "boolean"
    },
    "head": {
     "description": "head branch (required for 'create')",
     "type": "string"
    },
    "head_commit_id": {
     "description": "expected head SHA for conflict detection",
     "type": "string"
    },
    "labels": {
     "description": "label names or IDs",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "merge_style": {
     "default": "merge",
     "description": "for 'merge'",
     "enum": [
      "merge",
      "rebase",
      "rebase-merge",
      "squash",
      "fast-forward-only"
     ],
     "type": "string"
    },
    "merge_when_checks_succeed": {
     "description": "for 'merge'",
     "type": "boolean"
    },
    "message": {
     "description": "merge commit message or dismissal reason",
     "type": "string"
    },
    "method": {
     "enum": [
      "create",
      "update",
      "close",
      "reopen",
      "merge",
      "update_branch",
      "add_reviewers",
      "remove_reviewers"
     ],
     "type": "string"
    },
    "milestone": {
     "description": "for 'create'/'update'",
     "type": "number"
    },
    "owner": {
     "type": "string"
    },
    "pull_number": {
     "description": "required except for 'create'",
     "type": "number"
    },
    "remove_deadline": {
     "description": "for 'update'",
     "type": "boolean"
    },
    "repo": {
     "type": "string"
    },
    "reviewers": {
     "description": "for 'create'/'add_reviewers'/'remove_reviewers'",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "state": {
     "description": "for 'update'",
     "enum": [
      "open",
      "closed"
     ],
     "type": "string"
    },
    "team_reviewers": {
     "description": "for 'create'/'add_reviewers'/'remove_reviewers'",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "title": {
     "description": "required for 'create'; optional for 'update'/'merge'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Create, update, close, reopen, or merge pull requests"
  }
 },
 {
  "name": "release_read",
  "description": "Read releases by ID, tag or latest, list or download their assets.",
  "inputSchema": {
   "properties": {
    "attachment_id": {
     "description": "required for 'get_asset'/'download_asset'",
     "type": "number"
    },
    "id": {
     "description": "required for 'get' and asset methods",
     "type": "number"
    },
    "is_draft": {
     "description": "for 'list'",
     "type": "boolean"
    },
    "is_pre_release": {
     "description": "for 'list'",
     "type": "boolean"
    },
    "method": {
     "enum": [
      "list",
      "get",
      "get_by_tag",
      "get_latest",
      "list_assets",
      "get_asset",
      "download_asset"
     ],
     "type": "string"
    },
    "output_path": {
     "description": "for 'download_asset', optional local file path",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "per_page": {
     "default": 20,
     "minimum": 1,
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "tag": {
     "description": "required for 'get_by_tag'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read releases"
  }
 },
 {
  "name": "release_write",
  "description": "Write releases, upload or delete their assets.",
  "inputSchema": {
   "properties": {
    "attachment_id": {
     "description": "required for 'delete_asset'",
     "type": "number"
    },
    "body": {
     "description": "for 'create'/'update', omitted or empty fields stay unchanged on update",
     "type": "string"
    },
    "content": {
     "description": "base64, required for 'upload_asset'",
     "type": "string"
    },
    "id": {
     "description": "required except for 'create'",
     "type": "number"
    },
    "is_draft": {
     "description": "for 'create'/'update'",
     "type": "boolean"
    },
    "is_pre_release": {
     "description": "for 'create'/'update'",
     "type": "boolean"
    },
    "method": {
     "enum": [
      "create",
      "update",
      "delete",
      "upload_asset",
      "delete_asset"
     ],
     "type": "string"
    },
    "name": {
     "description": "filename, required for 'upload_asset'",
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "tag_name": {
     "description": "required for 'create', optional for 'update'",
     "type": "string"
    },
    "target": {
     "description": "commitish, required for 'create', optional for 'update'",
     "type": "string"
    },
    "title": {
     "description": "required for 'create', optional for 'update'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Write releases"
  }
 },
 {
  "name": "repo_read",
  "description": "Read a repository, list yours or an org's, and read branch protections.",
  "inputSchema": {
   "properties": {
    "method": {
     "enum": [
      "get",
      "list_my_repos",
      "list_org_repos",
      "list_branch_protections",
      "get_branch_protection"
     ],
     "type": "string"
    },
    "org": {
     "description": "for \"list_org_repos\"",
     "type": "string"
    },
    "owner": {
     "description": "required except list_my_repos/list_org_repos",
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "minimum": 1,
     "type": "number"
    },
    "repo": {
     "description": "required for get and branch protections",
     "type": "string"
    },
    "rule_name": {
     "description": "required for get_branch_protection",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read repositories"
  }
 },
 {
  "name": "repo_write",
  "description": "Write repositories (create, fork, settings, topics) and branch protections.",
  "inputSchema": {
   "properties": {
    "auto_init": {
     "type": "boolean"
    },
    "default_branch": {
     "type": "string"
    },
    "description": {
     "type": "string"
    },
    "gitignores": {
     "type": "string"
    },
    "issue_labels": {
     "type": "string"
    },
    "license": {
     "type": "string"
    },
    "method": {
     "enum": [
      "create",
      "fork",
      "update",
      "create_branch_protection",
      "update_branch_protection",
      "delete_branch_protection"
     ],
     "type": "string"
    },
    "name": {
     "description": "required for create, optional fork name",
     "type": "string"
    },
    "object_format_name": {
     "enum": [
      "sha1",
      "sha256"
     ],
     "type": "string"
    },
    "options": {
     "description": "update/branch protection API fields, required for update_branch_protection or update without topics, omitted fields unchanged",
     "properties": {},
     "type": "object"
    },
    "org": {
     "description": "create/fork target, defaults to personal account",
     "type": "string"
    },
    "owner": {
     "description": "required except create, source owner for fork",
     "type": "string"
    },
    "private": {
     "type": "boolean"
    },
    "readme": {
     "type": "string"
    },
    "repo": {
     "description": "required except create, source repo for fork",
     "type": "string"
    },
    "rule_name": {
     "description": "required for branch protections, branch name or glob",
     "type": "string"
    },
    "template": {
     "type": "boolean"
    },
    "topics": {
     "description": "for 'update': replaces all topics",
     "items": {
      "type": "string"
     },
     "type": "array"
    },
    "trust_model": {
     "enum": [
      "default",
      "collaborator",
      "committer",
      "collaboratorcommitter"
     ],
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Write repositories"
  }
 },
 {
  "name": "search_issues",
  "description": "Full-text search of issues and pull requests across repositories.",
  "inputSchema": {
   "properties": {
    "labels": {
     "description": "comma-separated",
     "type": "string"
    },
    "owner": {
     "description": "filter by owner",
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "query": {
     "type": "string"
    },
    "state": {
     "enum": [
      "open",
      "closed",
      "all"
     ],
     "type": "string"
    },
    "type": {
     "enum": [
      "issues",
      "pulls"
     ],
     "type": "string"
    }
   },
   "required": [
    "query"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Search issues"
  }
 },
 {
  "name": "search_org_teams",
  "description": "Search an organization's teams by name.",
  "inputSchema": {
   "properties": {
    "include_description": {
     "type": "boolean"
    },
    "org": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "query": {
     "type": "string"
    }
   },
   "required": [
    "org",
    "query"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Search organization teams"
  }
 },
 {
  "name": "search_repos",
  "description": "Search repositories by keyword.",
  "inputSchema": {
   "properties": {
    "is_archived": {
     "type": "boolean"
    },
    "is_private": {
     "type": "boolean"
    },
    "keyword_in_description": {
     "type": "boolean"
    },
    "keyword_is_topic": {
     "type": "boolean"
    },
    "order": {
     "type": "string"
    },
    "owner_id": {
     "type": "number"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "query": {
     "type": "string"
    },
    "sort": {
     "type": "string"
    }
   },
   "required": [
    "query"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Search repositories"
  }
 },
 {
  "name": "search_users",
  "description": "Search users by username or full name.",
  "inputSchema": {
   "properties": {
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "query": {
     "type": "string"
    }
   },
   "required": [
    "query"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Search users"
  }
 },
 {
  "name": "tag_read",
  "description": "Read tags.",
  "inputSchema": {
   "properties": {
    "method": {
     "enum": [
      "list",
      "get"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page": {
     "default": 1,
     "minimum": 1,
     "type": "number"
    },
    "per_page": {
     "default": 20,
     "minimum": 1,
     "type": "number"
    },
    "repo": {
     "type": "string"
    },
    "tag_name": {
     "description": "for 'get'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read tags"
  }
 },
 {
  "name": "tag_write",
  "description": "Create or delete tags.",
  "inputSchema": {
   "properties": {
    "message": {
     "description": "annotation for 'create'",
     "type": "string"
    },
    "method": {
     "enum": [
      "create",
      "delete"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "tag_name": {
     "description": "for 'create', 'delete'",
     "type": "string"
    },
    "target": {
     "description": "commitish for 'create'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Write tags"
  }
 },
 {
  "name": "timetracking_read",
  "description": "Read tracked times and stopwatches.",
  "inputSchema": {
   "properties": {
    "issue_number": {
     "description": "for 'list_issue_times'",
     "type": "number"
    },
    "method": {
     "enum": [
      "list_issue_times",
      "list_repo_times",
      "get_my_stopwatches",
      "get_my_times"
     ],
     "type": "string"
    },
    "owner": {
     "description": "for list_* methods",
     "type": "string"
    },
    "page": {
     "default": 1,
     "type": "number"
    },
    "per_page": {
     "default": 30,
     "type": "number"
    },
    "repo": {
     "description": "for list_* methods",
     "type": "string"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read tracked time"
  }
 },
 {
  "name": "timetracking_write",
  "description": "Write stopwatches and tracked times.",
  "inputSchema": {
   "properties": {
    "id": {
     "description": "entry ID (for 'delete_time')",
     "type": "number"
    },
    "issue_number": {
     "type": "number"
    },
    "method": {
     "enum": [
      "start_stopwatch",
      "stop_stopwatch",
      "delete_stopwatch",
      "add_time",
      "delete_time"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "time": {
     "description": "seconds (for 'add_time')",
     "type": "number"
    }
   },
   "required": [
    "method"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": false,
   "title": "Add or manage tracked time"
  }
 },
 {
  "name": "wiki_read",
  "description": "Read wiki pages and revisions.",
  "inputSchema": {
   "properties": {
    "method": {
     "enum": [
      "list",
      "get",
      "get_revisions"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page_name": {
     "description": "for 'get'/'get_revisions'",
     "type": "string"
    },
    "repo": {
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "readOnlyHint": true,
   "title": "Read wiki pages"
  }
 },
 {
  "name": "wiki_write",
  "description": "Write wiki pages.",
  "inputSchema": {
   "properties": {
    "content": {
     "description": "for 'create'/'update'",
     "type": "string"
    },
    "message": {
     "description": "commit message",
     "type": "string"
    },
    "method": {
     "enum": [
      "create",
      "update",
      "delete"
     ],
     "type": "string"
    },
    "owner": {
     "type": "string"
    },
    "page_name": {
     "description": "for 'update'/'delete'",
     "type": "string"
    },
    "repo": {
     "type": "string"
    },
    "title": {
     "description": "for 'create'",
     "type": "string"
    }
   },
   "required": [
    "method",
    "owner",
    "repo"
   ],
   "type": "object"
  },
  "annotations": {
   "destructiveHint": true,
   "readOnlyHint": false,
   "title": "Create, update, or delete wiki pages"
  }
 }
];
