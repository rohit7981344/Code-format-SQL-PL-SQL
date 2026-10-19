# SQL & PL/SQL Formatter (SQL Developer style)

A VS Code extension that formats Oracle SQL and PL/SQL the way **Oracle SQL Developer** does by default:
UPPERCASE keywords, lowercase names, 4-space indentation, every clause on its own line, one column per line,
and AND / OR conditions on new lines. Every rule can be changed in VS Code settings.

## Before / after

```sql
select e.empno, e.ename, d.dname from emp e join dept d on e.deptno = d.deptno where e.sal > 1000 and d.loc = 'DALLAS' order by e.ename;
```

```sql
SELECT
    e.empno,
    e.ename,
    d.dname
FROM
    emp e
    JOIN dept d ON e.deptno = d.deptno
WHERE
    e.sal > 1000
    AND d.loc = 'DALLAS'
ORDER BY
    e.ename;
```

```sql
CREATE OR REPLACE PROCEDURE raise_salary (
    p_empno IN emp.empno%TYPE,
    p_pct IN NUMBER DEFAULT 10
) IS
    v_sal emp.sal%TYPE;
BEGIN
    SELECT
        sal
    INTO v_sal
    FROM
        emp
    WHERE
        empno = p_empno;
    IF v_sal > 5000 THEN
        RAISE e_too_high;
    ELSE
        v_sal := v_sal + (v_sal * p_pct / 100);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END raise_salary;
/
```

## Install

1. Download the latest `sql-plsql-formatter-x.y.z.vsix` from the [Releases](https://github.com/rohit7981344/Code-format-SQL-PL-SQL/releases) page.
2. In VS Code open **Extensions** (Ctrl+Shift+X) → **⋯** menu → **Install from VSIX…** → pick the file.
3. Reload VS Code if asked.

## Use

- Open a `.sql`, `.pks`, `.pkb`, `.prc`, `.fnc`, `.trg` … file.
- Press **Shift+Alt+F** (Format Document), or select some lines and press **Ctrl+K Ctrl+F** (Format Selection).
- If VS Code asks which formatter to use, pick **SQL & PL/SQL Formatter**.
- Optional: format every time you save — add to your `settings.json`:

```json
"[sql]": {
  "editor.defaultFormatter": "rohit7981344.sql-plsql-formatter",
  "editor.formatOnSave": true
},
"[plsql]": {
  "editor.defaultFormatter": "rohit7981344.sql-plsql-formatter",
  "editor.formatOnSave": true
}
```

## Settings

| Setting | Default | Options |
|---|---|---|
| `sqlPlsqlFormatter.keywordCase` | `upper` | `upper`, `lower`, `preserve` |
| `sqlPlsqlFormatter.identifierCase` | `lower` | `lower`, `upper`, `preserve` |
| `sqlPlsqlFormatter.indentSize` | `4` | 1–8 |
| `sqlPlsqlFormatter.useTabs` | `false` | |
| `sqlPlsqlFormatter.useEditorIndentation` | `false` | use the editor's tab size instead |
| `sqlPlsqlFormatter.commaPosition` | `trailing` | `trailing`, `leading` |
| `sqlPlsqlFormatter.breakAndOr` | `true` | AND / OR on new lines in WHERE / HAVING |
| `sqlPlsqlFormatter.maxBlankLines` | `1` | blank lines kept between statements |

## Safe by design

The formatter only changes **whitespace and letter case**. Before applying a change it re-reads the result and
compares it to your original code; if anything else would differ, it leaves the code untouched and shows a warning.
Strings, `q'[...]'` literals, comments, `"Quoted Names"` and SQL*Plus commands (`SET`, `PROMPT`, `@script`, `/`)
are kept as they are.

## Develop

Requires Node.js and TypeScript (`npm i -g typescript`). No other dependencies.

```bash
tsc -p .                      # compile src/ -> out/
node test/run.js -v           # format the samples in test/samples and check them
python3 scripts/build_vsix.py # build the .vsix package
```

To test inside VS Code, open this folder and press **F5** (Run Extension).

Change the formatting rules in `src/formatter.ts` and the keyword lists in `src/keywords.ts`.

## License

MIT
