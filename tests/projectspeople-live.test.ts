import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, type McpTestClient, requireEnv } from "./utils";

type Project = {
  id: number;
  name: string;
  description?: string;
  dock?: Array<{ name: string; id: number; enabled?: boolean }>;
};

type Person = {
  id: number;
  name: string;
  email?: string | null;
  title?: string | null;
};

let mcp: McpTestClient;
let projectId: number;
let me: Person;

beforeAll(async () => {
  mcp = await createTestClient();
  projectId = Number(requireEnv("BASECAMP_BUCKET_ID"));
  me = await mcp.json<Person>("basecamp_get_me");
});

afterAll(async () => {
  await mcp?.close();
});

describe("Basecamp projects + people via MCP tools (live)", () => {
  it("lists active projects as an array of valid entries", async () => {
    const projects = await mcp.json<Project[]>("basecamp_list_projects");
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);

    // Every entry has a numeric id and a non-empty name.
    for (const p of projects) {
      expect(typeof p.id).toBe("number");
      expect(typeof p.name).toBe("string");
      expect(p.name.length).toBeGreaterThan(0);
    }

    // basecamp_list_projects returns ACTIVE projects only. The sandbox project
    // in this account is archived, so it is intentionally NOT expected here; it
    // is fetched directly by id in the get_project test below. If it ever does
    // appear (un-archived), it must still be a well-formed entry.
    const sandbox = projects.find((p) => p.id === projectId);
    if (sandbox) {
      expect(sandbox.name.length).toBeGreaterThan(0);
    }
  });

  it("filters projects by name regex, returning a matching subset", async () => {
    const all = await mcp.json<Project[]>("basecamp_list_projects");
    const fragment = all[0].name.slice(0, Math.min(3, all[0].name.length));
    const filtered = await mcp.json<Project[]>("basecamp_list_projects", {
      filter: fragment,
    });
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(all.length);

    const regex = new RegExp(fragment, "i");
    for (const p of filtered) {
      const matches = regex.test(p.name) || regex.test(p.description || "");
      expect(matches).toBe(true);
    }
  });

  it("gets the sandbox project with name and dock array", async () => {
    const project = await mcp.json<Project>("basecamp_get_project", {
      project_id: projectId,
    });
    expect(project.id).toBe(projectId);
    expect(typeof project.name).toBe("string");
    expect(project.name.length).toBeGreaterThan(0);
    expect(Array.isArray(project.dock)).toBe(true);
  });

  it("returns my own profile from get_me", async () => {
    expect(typeof me.id).toBe("number");
    expect(me.id).toBeGreaterThan(0);
    expect(typeof me.name).toBe("string");
    expect(me.name.length).toBeGreaterThan(0);
    // get_me surfaces an email field (the authenticated user's own address).
    expect(typeof me.email).toBe("string");
    expect(me.email?.length).toBeGreaterThan(0);
  });

  it("lists people, including myself", async () => {
    const people = await mcp.json<Person[]>("basecamp_list_people");
    expect(Array.isArray(people)).toBe(true);
    expect(people.length).toBeGreaterThan(0);

    const self = people.find((p) => p.id === me.id);
    expect(self).toBeDefined();
    expect(self?.name).toBe(me.name);
  });

  it("gets a single person by id", async () => {
    const person = await mcp.json<Person>("basecamp_get_person", {
      person_id: me.id,
    });
    expect(person.id).toBe(me.id);
    expect(typeof person.name).toBe("string");
    expect(person.name.length).toBeGreaterThan(0);
  });

  it("filters people by a regex substring of my own name", async () => {
    // Use a short substring of my name as the filter so I match myself.
    const fragment = me.name.slice(0, Math.min(3, me.name.length));
    const filtered = await mcp.json<Person[]>("basecamp_list_people", {
      filter: fragment,
    });
    expect(Array.isArray(filtered)).toBe(true);

    const regex = new RegExp(fragment, "i");
    // Every returned entry must match the filter (against name, email, or title,
    // mirroring the tool's filter semantics).
    for (const p of filtered) {
      const matches =
        regex.test(p.name) ||
        regex.test(p.email || "") ||
        regex.test(p.title || "");
      expect(matches).toBe(true);
    }
    // I should be in the filtered subset since the fragment came from my name.
    expect(filtered.some((p) => p.id === me.id)).toBe(true);
  });
});
