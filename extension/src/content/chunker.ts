export function chunkText(text: string, maxCharacters: number = 4000): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  
  let currentChunk = "";

  for (const p of paragraphs) {
    if (currentChunk.length + p.length > maxCharacters) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = p;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + p;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  // If a single paragraph is still larger than maxCharacters, split it by sentences
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length > maxCharacters) {
      let subChunk = "";
      const sentences = chunk.match(/[^.!?]+[.!?]+/g) || [chunk];
      for (const s of sentences) {
        if (subChunk.length + s.length > maxCharacters) {
          if (subChunk) finalChunks.push(subChunk.trim());
          subChunk = s;
        } else {
          subChunk += (subChunk ? " " : "") + s;
        }
      }
      if (subChunk) finalChunks.push(subChunk.trim());
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}
