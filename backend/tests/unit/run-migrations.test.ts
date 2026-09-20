/** @format */

const { splitStatements, needsBaseline, selectPendingFiles } =
  require("../../../scripts/run-migrations") as {
    splitStatements: (sql: string) => string[];
    needsBaseline: (appliedCount: number, hasCoreSchema: boolean) => boolean;
    selectPendingFiles: (
      files: string[],
      appliedFilenames: string[]
    ) => string[];
  };

describe("run-migrations SQL tokenizer", () => {
  describe("splitStatements", () => {
    it("should split simple statements on semicolons", () => {
      const sql = "CREATE TABLE a (id int);\nINSERT INTO a VALUES (1);\n";
      expect(splitStatements(sql)).toEqual([
        "CREATE TABLE a (id int)",
        "INSERT INTO a VALUES (1)",
      ]);
    });

    it("should not split on semicolons inside single-quoted strings", () => {
      const sql = `INSERT INTO t VALUES ('a;b');SELECT 1;`;
      expect(splitStatements(sql)).toEqual([
        `INSERT INTO t VALUES ('a;b')`,
        "SELECT 1",
      ]);
    });

    it("should handle escaped single quotes ('') inside strings", () => {
      const sql = `INSERT INTO t VALUES ('it''s;fine');SELECT 1;`;
      expect(splitStatements(sql)).toEqual([
        `INSERT INTO t VALUES ('it''s;fine')`,
        "SELECT 1",
      ]);
    });

    it("should not split on semicolons inside dollar-quoted blocks", () => {
      const sql = [
        "CREATE FUNCTION f() RETURNS void AS $$",
        "BEGIN",
        "  RAISE NOTICE 'a;b';",
        "END;",
        "$$ LANGUAGE plpgsql;",
        "SELECT 1;",
      ].join("\n");
      const statements = splitStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain("LANGUAGE plpgsql");
    });

    it("should not split on semicolons inside line or block comments", () => {
      const sql = [
        "-- comment with a; semicolon",
        "SELECT 1;",
        "/* block; comment */",
        "SELECT 2;",
      ].join("\n");
      const statements = splitStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain("-- comment with a; semicolon");
      expect(statements[1]).toContain("/* block; comment */");
    });

    it("should keep CREATE INDEX CONCURRENTLY standalone", () => {
      const sql = [
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_id ON users(id);",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);",
      ].join("\n");
      const statements = splitStatements(sql);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain("CONCURRENTLY");
      expect(statements[1]).toContain("CONCURRENTLY");
    });

    it("should drop statements that are only comments/whitespace", () => {
      const sql = ";  -- just a comment\n;SELECT 1;;\n";
      expect(splitStatements(sql)).toEqual(["SELECT 1"]);
    });

    it("should handle double-quoted identifiers with semicolons", () => {
      const sql = `SELECT "col;name" FROM t;SELECT 1;`;
      expect(splitStatements(sql)).toEqual([
        `SELECT "col;name" FROM t`,
        "SELECT 1",
      ]);
    });
  });
});

describe("run-migrations ledger helpers", () => {
  describe("needsBaseline", () => {
    it("should baseline when the ledger is empty but the core schema exists (pre-ledger deployment)", () => {
      expect(needsBaseline(0, true)).toBe(true);
    });

    it("should not baseline on a fresh empty database (must run migrations for real)", () => {
      expect(needsBaseline(0, false)).toBe(false);
    });

    it("should not baseline when the ledger already has entries", () => {
      expect(needsBaseline(3, true)).toBe(false);
    });
  });

  describe("selectPendingFiles", () => {
    it("should return files not present in the applied ledger, preserving order", () => {
      const files = ["001_a.sql", "002_b.sql", "003_c.sql"];
      expect(selectPendingFiles(files, ["001_a.sql", "003_c.sql"])).toEqual([
        "002_b.sql",
      ]);
    });

    it("should return all files when the ledger is empty", () => {
      const files = ["001_a.sql", "002_b.sql"];
      expect(selectPendingFiles(files, [])).toEqual(files);
    });
  });
});
