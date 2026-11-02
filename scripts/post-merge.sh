#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
# Generated declarations must match the merged source before leaf validation.
pnpm run typecheck:libs
