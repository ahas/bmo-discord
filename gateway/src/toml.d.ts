// Bun imports a TOML file as the table it holds; what each file's table is, its reader states.
declare module "*.toml" {
  const table: Record<string, unknown>;
  export default table;
}
