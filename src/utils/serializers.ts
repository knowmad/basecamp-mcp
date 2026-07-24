/**
 * Serialization utilities for Basecamp API responses
 */

/**
 * Person object from Basecamp API
 */
interface BasecampPerson {
  id: number;
  name: string;
  attachable_sgid?: string;
}

/**
 * Serialized person object for MCP responses
 */
export interface SerializedPerson {
  id: number;
  name: string;
  attachable_sgid?: string;
}

/**
 * Serialize a Basecamp person object to a consistent format
 * @param person - The person object from Basecamp API
 * @returns Serialized person with id and name
 */
export function serializePerson(
  person: BasecampPerson | null | undefined,
): SerializedPerson | null {
  if (!person) {
    return null;
  }

  return {
    id: person.id,
    name: person.name,
    attachable_sgid: person.attachable_sgid,
  };
}

/**
 * Creator object as exposed by the activity feed and campfire browsing tools:
 * id + name + email. In contrast to {@link serializePerson}, this surfaces the
 * email address (useful for attributing activity) rather than the
 * `attachable_sgid` (which is only needed for attachment authoring).
 */
export function serializeCreator(
  person:
    | { id: number; name: string; email_address?: string }
    | null
    | undefined,
): { id: number; name: string; email?: string } | null {
  if (!person) {
    return null;
  }

  return {
    id: person.id,
    name: person.name,
    email: person.email_address,
  };
}
