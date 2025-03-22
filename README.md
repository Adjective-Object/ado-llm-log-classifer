# ado-llm-log-classifer

downloading and using llms to classify error logs from Azure Devops.

requires docker for downloading and converting models to GGUF

# setup
Open in devcontainer
git config --local user.email "your@email"
git config --local user.name "Your Name"

Generate access tokens at:
- huggingface: https://huggingface.co/settings/tokens (repo:read access to all public gated repos you can access)
- ado: <orgname>.visualstudio.com/_usersSettings/tokens (build:read and code: read access)

# useful scripts
```sh
# Builds and runs tests.
# This is preferrable compared to ts-jest based transformation
# because jest refuses to recognize .mts spec files.
yarn test

# builds, then downloads logs
yarn tsc && node ./lib/dl-logs.mjs
# builds, then classifies downloaded logs
yarn tsc && node ./lib/classify-logs.mjs

```