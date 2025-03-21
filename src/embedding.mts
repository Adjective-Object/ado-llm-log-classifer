import { LlamaEmbedding, type LlamaEmbeddingContext, type Token } from "node-llama-cpp"
import { tokenizeText } from "node-llama-cpp"

export type EmbeddedJobFailure = {
    jobId: number
    issues: LlamaEmbedding[]
    log?: LlamaEmbedding
}

function getCtxSize(modelCtx: LlamaEmbeddingContext): number {
    return (modelCtx as any)._llamaContext.contextSize;
}

export function tokenizeAndChunkText(text: string, modelCtx: LlamaEmbeddingContext): Token[][] {
    let ctxSize = getCtxSize(modelCtx)
    let tokens = tokenizeText(text, modelCtx.model.tokenizer);
    let chunks: Token[][] = []
    for (let i = 0; i < tokens.length; i += ctxSize) {
        chunks.push(tokens.slice(i, i + ctxSize));
    }
    return chunks;
}

export async function embedChunkedTokens(
    tokenChunks: Token[][],
    modelCtx: LlamaEmbeddingContext
): Promise<LlamaEmbedding> {


    let ctxSize = getCtxSize(modelCtx)
    // tokenise the text
    // chunk the tokens by the model's context size
    let chunkedEmbedPromises: Promise<LlamaEmbedding>[] = []
    for (let i = 0; i < tokenChunks.length; i += ctxSize) {
        let chunk = tokenChunks[i];
        chunkedEmbedPromises.push(modelCtx.getEmbeddingFor(chunk));
    }
    let chunks = await Promise.all(chunkedEmbedPromises);

    // average the embeddings
    let avgEmbed: number[] = []
    // fill avgEmbed with zeros
    for (let i = 0; i < chunks[0].vector.length; i++) {
        avgEmbed.push(0);
    }
    for (let i = 0; i < chunks.length; i++) {
        for (let j = 0; j < chunks[i].vector.length; j++) {
            avgEmbed[j] += chunks[i].vector[j] * (1 / chunks.length);
        }
    }

    return new LlamaEmbedding({ vector: avgEmbed });
}

const MEMO_LIMIT = 1000;
export class MemoizedEmbedder {
    private memo: Map<string, LlamaEmbedding> = new Map();
    constructor(private modelCtx: LlamaEmbeddingContext) { }
    async embed(text: string): Promise<LlamaEmbedding> {
        if (this.memo.has(text)) {
            return this.memo.get(text)!;
        }
        let chunks = tokenizeAndChunkText(text, this.modelCtx);
        let embed = await embedChunkedTokens(chunks, this.modelCtx);
        this.memo.set(text, embed);

        // if the memo is too large, drop an arbitrary entry
        if (this.memo.size > MEMO_LIMIT) {
            let randomKey = this.memo.keys().next().value;
            if (randomKey) {
                this.memo.delete(randomKey);
            }
        }

        return embed;
    }
}