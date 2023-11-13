import fg from "fast-glob";
import fs from "node:fs/promises";
import { AnyCollection, InternalConfiguration } from "./config";
import matter from "gray-matter";
import { readFile } from "fs/promises";
import path from "node:path";

async function processFile(collection: AnyCollection, filePath: string) {
  const file = await readFile(filePath, "utf-8");
  const { data } = matter(file);

  const parsedData = await collection.schema.parseAsync(data);
  return {
    ...parsedData,
    _document: {
      path: filePath,
    },
  };
}

export async function processCollection(collection: AnyCollection) {
  const files = await fg(collection.sources);
  const promises = files.map((file) => processFile(collection, file));
  const data = await Promise.all(promises);

  return {
    data,
    name: collection.name,
  };
}

function createArrayConstName(name: string) {
  return "all" + name.charAt(0).toUpperCase() + name.slice(1);
}

async function createDataFiles(
  configuration: InternalConfiguration,
  directory: string
) {
  const collections = configuration.collections;
  for (const collection of collections) {
    const result = await processCollection(collection);
    const dataPath = path.join(
      directory,
      `${createArrayConstName(collection.name)}.json`
    );
    await fs.writeFile(dataPath, JSON.stringify(result.data, null, 2));
  }
}

async function createJavaScriptFile(
  configuration: InternalConfiguration,
  directory: string
) {
  const collections = configuration.collections.map(({ name }) =>
    createArrayConstName(name)
  );

  let content = "";
  for (const name of collections) {
    content += `import ${name} from "./${name}.json";\n`;
  }
  content += "\n";
  content += "export { " + collections.join(", ") + " };\n";

  await fs.writeFile(path.join(directory, "index.js"), content, "utf-8");
}

async function createTypeDefinitionFile(
  configuration: InternalConfiguration,
  directory: string
) {
  const importPath = path.relative(directory, configuration.path);
  let content = `import _config from "${importPath}";
import z from "zod";

type _Document = {
  path: string;
};

type _Collections = typeof _config["collections"];

type _CollectionsByName = {
    [TCollection in _Collections[number] as TCollection["name"]]: _Collections[number];
};

type _GetByName<TName extends string> = _CollectionsByName[TName];
`;

  const collections = configuration.collections;
  for (const collection of collections) {
    content += `\n`;
    content += `export type ${collection.typeName} = z.infer<_GetByName<"${collection.name}">["schema"]> & { _document: _Document; };\n`;
    content += `export declare const ${createArrayConstName(
      collection.name
    )}: Array<${collection.typeName}>;\n`;
  }

  content += "\n";
  // https://github.com/microsoft/TypeScript/issues/38592
  content += "export {};\n";

  await fs.writeFile(path.join(directory, "index.d.ts"), content, "utf-8");
}

export async function run(configuration: InternalConfiguration) {
  const directory = path.join(".mdx-collections", "generated");
  await fs.mkdir(directory, { recursive: true });

  await createDataFiles(configuration, directory);
  await createJavaScriptFile(configuration, directory);
  await createTypeDefinitionFile(configuration, directory);
}
