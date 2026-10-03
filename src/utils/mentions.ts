/**
 * Mentions by person ID in rich text.
 *
 * A Basecamp mention needs the attachable_sgid of the person: a long signed
 * string. If one character of it is wrong, Basecamp keeps the post but shows
 * a broken attachment, and it notifies nobody. Thus, the tools let the LLM
 * write the person ID, and replace it with the correct markup before the
 * write.
 */

import { type BasecampClient, mentionMarkup } from "@37signals/basecamp";
import type { ContentOperationParams } from "./contentOperations.js";
import { handleBasecampError } from "./errorHandlers.js";

/**
 * Finds a mention tag that names a person by ID, for example
 * <bc-attachment person-id="123"></bc-attachment>. The closing tag is
 * optional.
 */
const PERSON_MENTION_PATTERN =
  /<bc-attachment\b[^>]*?\sperson-id\s*=\s*["']?(\d+)["']?[^>]*>(?:\s*<\/bc-attachment>)?/gi;

/**
 * The text for the HTML rules of the tools.
 */
export const mentionRule =
  'To mention a person: <bc-attachment person-id="{ person.id }"></bc-attachment>. Put the tag where the name must show in the text, for example "Thanks <bc-attachment person-id="123"></bc-attachment> for the fix". The person gets a notification. If the ID is not a person, the tool returns an error and writes nothing. Get person IDs from basecamp_list_people, or from the people in other responses (assignees, creators).';

/**
 * Replace each person-id mention tag in the HTML with the mention markup of
 * the person. Read each person one time. If a person read fails, throw, so
 * that the caller writes nothing.
 */
export async function expandPersonMentions(
  client: BasecampClient,
  html: string,
): Promise<string> {
  const ids = [
    ...new Set(
      [...html.matchAll(PERSON_MENTION_PATTERN)].map((match) =>
        Number(match[1]),
      ),
    ),
  ];
  if (ids.length === 0) return html;

  const markupById = new Map<number, string>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        const person = await client.people.get(id);
        markupById.set(id, mentionMarkup(person));
      } catch (error) {
        throw new Error(
          `Cannot mention person ${id}: ${handleBasecampError(error)} Nothing was written. Get person IDs from basecamp_list_people.`,
        );
      }
    }),
  );

  return html.replace(
    PERSON_MENTION_PATTERN,
    (_tag, id: string) => markupById.get(Number(id)) as string,
  );
}

/**
 * Expand the person-id mentions in the content fields of an update tool.
 * Do not change the "find" strings: they must match the current content.
 */
export async function expandPersonMentionsInOperations<
  T extends ContentOperationParams,
>(client: BasecampClient, params: T): Promise<T> {
  const expand = (html: string | undefined) =>
    html === undefined ? undefined : expandPersonMentions(client, html);

  const [content, contentAppend, contentPrepend, searchReplace] =
    await Promise.all([
      expand(params.content),
      expand(params.content_append),
      expand(params.content_prepend),
      params.search_replace === undefined
        ? undefined
        : Promise.all(
            params.search_replace.map(async (operation) => ({
              find: operation.find,
              replace: await expandPersonMentions(client, operation.replace),
            })),
          ),
    ]);

  return {
    ...params,
    content,
    content_append: contentAppend,
    content_prepend: contentPrepend,
    search_replace: searchReplace,
  };
}
