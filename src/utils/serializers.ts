/**
 * Serialization utilities for Basecamp API responses
 */

/**
 * Person object from Basecamp API
 */
interface BasecampPerson {
  id: number;
  name: string;
}

/**
 * Serialized person object for MCP responses
 */
export interface SerializedPerson {
  id: number;
  name: string;
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
  };
}
