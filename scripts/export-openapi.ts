import fs from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument } from '../src/docs';

const out = path.resolve(__dirname, '..', 'docs', 'openapi.json');
fs.writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`OpenAPI spec written to ${out}`);
