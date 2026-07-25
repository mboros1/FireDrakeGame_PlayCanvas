import fs from 'node:fs';
import path from 'node:path';

const JSON_CHUNK = 0x4e4f534a;
const GLB_MAGIC = 0x46546c67;

function paddedJson(value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  const padding = (4 - (bytes.length % 4)) % 4;
  return Buffer.concat([bytes, Buffer.alloc(padding, 0x20)]);
}

function sanitize(file) {
  const input = fs.readFileSync(file);
  if (input.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file} is not a GLB`);

  const version = input.readUInt32LE(4);
  const chunks = [];
  let offset = 12;
  while (offset < input.length) {
    const length = input.readUInt32LE(offset);
    const type = input.readUInt32LE(offset + 4);
    chunks.push({ type, data: input.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }

  const jsonChunk = chunks.find(chunk => chunk.type === JSON_CHUNK);
  if (!jsonChunk) throw new Error(`${file} has no JSON chunk`);
  const document = JSON.parse(jsonChunk.data.toString('utf8').trim());
  const removedImages = document.images?.length ?? 0;

  delete document.images;
  delete document.textures;
  delete document.samplers;
  for (const material of document.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }

  jsonChunk.data = paddedJson(document);
  const outputLength = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(outputLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(version, 4);
  output.writeUInt32LE(outputLength, 8);
  offset = 12;
  for (const chunk of chunks) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }
  fs.writeFileSync(file, output);
  return removedImages;
}

const target = process.argv[2];
if (!target) throw new Error('Usage: node sanitize-gltf.mjs <glb-file-or-directory>');
const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target)
      .filter(name => name.endsWith('.glb'))
      .map(name => path.join(target, name))
  : [target];

let removedImages = 0;
for (const file of files) removedImages += sanitize(file);
console.log(JSON.stringify({ files: files.length, removedImages }));
