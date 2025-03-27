# ado-llm-log-classifer

downloading and using llms to classify error logs from Azure Devops.

requires docker for downloading and converting models to GGUF

# approach
This is an extremely simple way of manually clustering ADO build failures based on example members of those clusters.
Jobs of builds are clustered based on a combination of the issue messages in the parent tasks of the job, as well as the log contents of the job, if any.

It works by downloading logs to your machine, then running an embedding model over them, and clustering them based on similarity to reference examples of each category, defined manually by the user.

# usage
1. first, run `yarn dl-logs` to download logs from your ADO instance.
   - You will be prompted for an ADO token, make sure it has the ability to read both code and build jobs.
   - Runtime arguments are persisted to `out/dl-logs-args.json`, to avoid re-prompting on subsequent runs.
   - `dl-logs` will download all available jobs that ran against the target git ref to `out/logs/${buildId}`.
   - note that git refs are a not the same thing as branches. e.g. `refs/heads/main` is the ref for the `main` branch
2. Then, run `yarn embed-logs` to generate embeddings for _all downloaded logs_
   - You will be prompted for a huggingface token. Make sure it has the ability to read repo contents
   - You will also be prompted for the path to a GGUF model in a repo, in `<repo-reference>:<path/in/repo.gguf>` format.
     I have had good results with [`CompendiumLabs/bge-small-en-v1.5-gguf:bge-small-en-v1.5-f32.gguf`](https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/blob/main/bge-small-en-v1.5-f32.gguf)
3. Once all the logs have embeddings, run `yarn create-clusters`.  
   - You will be repeatedly prompted to either assign a cluster ID to an outlier job, or create a new cluster ID based on a job.
   - Once you have a few clusters defined, you'll be able to create the clusters
4. Once you have assigned clusters for all jobs, run `yarn make-csv`.
   This script will generate 2 CSVs based on the cluster assignments for each job,
   - `out.csv`, with the individual cluster assignments for each job
   - `day-binned.csv`, with the counts of each day in each cluster.

# notes
- The clustering method here is both manual and very not ideal! But it is enough to get started with
- The log embeddings aren't super useful. The text of the log should probably be summarized before embedding
  - I looked at using BERT models for extractive summarization, but support in node-llama-cpp seems limited.
  - I am curious if abstractive summarization will be useful here, since the logs are not the normal conversational english that most off-the-shelf LLM models are trained on

# setup
Open in devcontainer
git config --local user.email "your@email"
git config --local user.name "Your Name"

Generate access tokens at:
- huggingface: [`https://huggingface.co/settings/tokens`](https://huggingface.co/settings/tokens) (repo:read access to all public gated repos you can access)
- ado: `<orgname>.visualstudio.com/_usersSettings/tokens` (build:read and code: read access)

# useful scripts
```sh
# Builds and runs tests.
# This is preferrable compared to ts-jest based transformation
# because jest refuses to recognize .mts spec files.
yarn test

# builds, then downloads logs
yarn dl-logs
# builds, then classifies downloaded logs
yarn embed-logs
# builds, then runs an interactive tool for creating clusters
yarn create-clusters
# processes the downloaded logs against the cluster definitions
yarn make-csv

```
