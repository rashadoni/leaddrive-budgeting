#!/bin/bash
# RETIRED: the Stage-2 scaffold generator encoded the historical
# custom-GUC bypass policy shape and also treated the shared industries catalog as
# organization-scoped. Re-running it could reintroduce a user-settable bypass.
# Current RLS changes must be explicit reviewed Prisma migrations with catalog
# preconditions and live negative controls.

set -euo pipefail

echo "gen-rls-migrations.sh is retired; create a reviewed Prisma migration instead." >&2
exit 1
