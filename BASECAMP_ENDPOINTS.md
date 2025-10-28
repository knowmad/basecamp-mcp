# Basecamp 3 API Endpoints

This file lists all available Basecamp 3 API endpoints.

[ ] Create an attachment: POST /attachments.json
[ ] Get a card table: GET /buckets/:id/card_tables/:id.json
[ ] Create a column: POST /buckets/:id/card_tables/:id/columns.json
[ ] Move a column: POST /buckets/:id/card_tables/:id/moves.json
[ ] Get a card: GET /buckets/:id/card_tables/cards/:id.json
[ ] Update a card: PUT /buckets/:id/card_tables/cards/:id.json
[ ] Move a card: POST /buckets/:id/card_tables/cards/:id/moves.json
[ ] Reposition a step: POST /buckets/:id/card_tables/cards/:id/positions.json
[ ] Create a step: POST /buckets/:id/card_tables/cards/:id/steps.json
[ ] Get a column: GET /buckets/:id/card_tables/columns/:id.json
[ ] Update a column: PUT /buckets/:id/card_tables/columns/:id.json
[ ] Change color of a column: PUT /buckets/:id/card_tables/columns/:id/color.json
[ ] Change on hold on a column: DELETE /buckets/:id/card_tables/columns/:id/on_hold.json
[ ] Change on hold on a column: POST /buckets/:id/card_tables/columns/:id/on_hold.json
[ ] Get cards in a column: GET /buckets/:id/card_tables/lists/:id/cards.json
[ ] Create a card: POST /buckets/:id/card_tables/lists/:id/cards.json
[ ] Watch a column: DELETE /buckets/:id/card_tables/lists/:id/subscription.json
[ ] Watch a column: POST /buckets/:id/card_tables/lists/:id/subscription.json
[ ] Update a step: PUT /buckets/:id/card_tables/steps/:id.json
[ ] Change step completion status: PUT /buckets/:id/card_tables/steps/:id/completions.json
[ ] Get message types: GET /buckets/:id/categories.json
[ ] Create a message type: POST /buckets/:id/categories.json
[ ] Destroy a message type: DELETE /buckets/:id/categories/:id.json
[ ] Get a message type: GET /buckets/:id/categories/:id.json
[ ] Update a message type: PUT /buckets/:id/categories/:id.json
[ ] Get a Campfire: GET /buckets/:id/chats/:id.json
[ ] Get chatbots: GET /buckets/:id/chats/:id/integrations.json
[ ] Create a chatbot: POST /buckets/:id/chats/:id/integrations.json
[ ] Destroy a chatbot: DELETE /buckets/:id/chats/:id/integrations/:id.json
[ ] Get a chatbot: GET /buckets/:id/chats/:id/integrations/:id.json
[ ] Update a chatbot: PUT /buckets/:id/chats/:id/integrations/:id.json
[ ] Get Campfire lines: GET /buckets/:id/chats/:id/lines.json
[ ] Create a Campfire line: POST /buckets/:id/chats/:id/lines.json
[ ] Delete a Campfire line: DELETE /buckets/:id/chats/:id/lines/:id.json
[ ] Get a Campfire line: GET /buckets/:id/chats/:id/lines/:id.json
[ ] Get client approvals: GET /buckets/:id/client/approvals.json
[ ] Get a client approval: GET /buckets/:id/client/approvals/:id.json
[ ] Get client correspondences: GET /buckets/:id/client/correspondences.json
[ ] Get a client correspondence: GET /buckets/:id/client/correspondences/:id.json
[ ] Get client replies: GET /buckets/:id/client/recordings/:id/replies.json
[ ] Get a client reply: GET /buckets/:id/client/recordings/:id/replies/:id.json
[ ] Get a comment: GET /buckets/:id/comments/:id.json
[ ] Update a comment: PUT /buckets/:id/comments/:id.json
[ ] Get a document: GET /buckets/:id/documents/:id.json
[ ] Update a document: PUT /buckets/:id/documents/:id.json
[ ] Get a forward: GET /buckets/:id/inbox_forwards/:id.json
[ ] Get inbox replies: GET /buckets/:id/inbox_forwards/:id/replies.json
[ ] Get an inbox reply: GET /buckets/:id/inbox_forwards/:id/replies/:id.json
[ ] Get inbox: GET /buckets/:id/inboxes/:id.json
[ ] Get forwards: GET /buckets/:id/inboxes/:id/forwards.json
[ ] Get message board: GET /buckets/:id/message_boards/:id.json
[ ] Get messages: GET /buckets/:id/message_boards/:id/messages.json
[ ] Create a message: POST /buckets/:id/message_boards/:id/messages.json
[ ] Get a message: GET /buckets/:id/messages/:id.json
[ ] Update a message: PUT /buckets/:id/messages/:id.json
[ ] Get a question answer: GET /buckets/:id/question_answers/:id.json
[ ] Get questionnaire: GET /buckets/:id/questionnaires/:id.json
[ ] Get questions: GET /buckets/:id/questionnaires/:id/questions.json
[ ] Get a question: GET /buckets/:id/questions/:id.json
[ ] Get question answers: GET /buckets/:id/questions/:id/answers.json
[ ] Toggle client visibility: PUT /buckets/:id/recordings/:id/client_visibility.json
[ ] Get comments: GET /buckets/:id/recordings/:id/comments.json
[ ] Create a comment: POST /buckets/:id/recordings/:id/comments.json
[ ] Get events: GET /buckets/:id/recordings/:id/events.json
[ ] Pin a message: DELETE /buckets/:id/recordings/:id/pin.json
[ ] Pin a message: POST /buckets/:id/recordings/:id/pin.json
[ ] Unarchive a recording: PUT /buckets/:id/recordings/:id/status/active.json
[ ] Archive a recording: PUT /buckets/:id/recordings/:id/status/archived.json
[ ] Trash a recording: PUT /buckets/:id/recordings/:id/status/trashed.json
[ ] Unsubscribe current user: DELETE /buckets/:id/recordings/:id/subscription.json
[ ] Get subscription: GET /buckets/:id/recordings/:id/subscription.json
[ ] Subscribe current user: POST /buckets/:id/recordings/:id/subscription.json
[ ] Update subscription: PUT /buckets/:id/recordings/:id/subscription.json
[ ] Get a schedule entry: GET /buckets/:id/schedule_entries/:id.json
[ ] Update a schedule entry: PUT /buckets/:id/schedule_entries/:id.json
[ ] Get schedule: GET /buckets/:id/schedules/:id.json
[ ] Update a schedule: PUT /buckets/:id/schedules/:id.json
[ ] Get schedule entries: GET /buckets/:id/schedules/:id/entries.json
[ ] Create a schedule entry: POST /buckets/:id/schedules/:id/entries.json
[ ] Get a to-do list group: GET /buckets/:id/todolists/:id.json
[ ] Get a to-do list: GET /buckets/:id/todolists/:id.json
[ ] Update a to-do list: PUT /buckets/:id/todolists/:id.json
[ ] List to-do list groups: GET /buckets/:id/todolists/:id/groups.json
[ ] Create a to-do list group: POST /buckets/:id/todolists/:id/groups.json
[ ] Get to-dos: GET /buckets/:id/todolists/:id/todos.json
[ ] Create a to-do: POST /buckets/:id/todolists/:id/todos.json
[ ] Reposition a to-do list group: PUT /buckets/:id/todolists/groups/:id/position.json
[ ] Get a to-do: GET /buckets/:id/todos/:id.json
[ ] Update a to-do: PUT /buckets/:id/todos/:id.json
[ ] Uncomplete a to-do: DELETE /buckets/:id/todos/:id/completion.json
[ ] Complete a to-do: POST /buckets/:id/todos/:id/completion.json
[ ] Reposition a to-do: PUT /buckets/:id/todos/:id/position.json
[ ] Get to-do set: GET /buckets/:id/todosets/:id.json
[ ] Get to-do lists: GET /buckets/:id/todosets/:id/todolists.json
[ ] Create a to-do list: POST /buckets/:id/todosets/:id/todolists.json
[ ] Get an upload: GET /buckets/:id/uploads/:id.json
[ ] Update an upload: PUT /buckets/:id/uploads/:id.json
[ ] Get a vault: GET /buckets/:id/vaults/:id.json
[ ] Update a vault: PUT /buckets/:id/vaults/:id.json
[ ] Get documents: GET /buckets/:id/vaults/:id/documents.json
[ ] Create a document: POST /buckets/:id/vaults/:id/documents.json
[ ] Get uploads: GET /buckets/:id/vaults/:id/uploads.json
[ ] Create an upload: POST /buckets/:id/vaults/:id/uploads.json
[ ] Get vaults: GET /buckets/:id/vaults/:id/vaults.json
[ ] Create a vault: POST /buckets/:id/vaults/:id/vaults.json
[ ] Get webhooks: GET /buckets/:id/webhooks.json
[ ] Create a webhook: POST /buckets/:id/webhooks.json
[ ] Destroy a webhook: DELETE /buckets/:id/webhooks/:id.json
[ ] Get a webhook: GET /buckets/:id/webhooks/:id.json
[ ] Update a webhook: PUT /buckets/:id/webhooks/:id.json
[ ] Get Campfires: GET /chats.json
[ ] Get pingable people: GET /circles/people.json
[ ] Create a line: POST /integrations/$CHATBOT_KEY/buckets/:id/chats/:id/lines.json
[ ] Create a marker: POST /lineup/markers.json
[ ] Destroy a marker: DELETE /lineup/markers/:id.json
[ ] Update a marker: PUT /lineup/markers/:id.json
[ ] Get my personal info: GET /my/profile.json
[ ] Get all people: GET /people.json
[ ] Get person: GET /people/:id.json
[ ] Get all projects: GET /projects.json
[ ] Create a project: POST /projects.json
[ ] Trash a project: DELETE /projects/:id.json
[ ] Get a project: GET /projects/:id.json
[ ] Update a project: PUT /projects/:id.json
[ ] Get people on a project: GET /projects/:id/people.json
[ ] Update who can access a project: PUT /projects/:id/people/users.json
[ ] Get timesheet for a recording: GET /projects/:id/recordings/:id/timesheet.json
[ ] Get timesheet for a project: GET /projects/:id/timesheet.json
[ ] Get recordings: GET /projects/recordings.json
[ ] Get timesheet report: GET /reports/timesheet.json
[ ] Get Templates: GET /templates.json
[ ] Create a Template: POST /templates.json
[ ] Trash a Template: DELETE /templates/:id.json
[ ] Get a Template: GET /templates/:id.json
[ ] Update a Template: PUT /templates/:id.json
[ ] Get a Project Construction: GET /templates/:id/project_constructions/:id.json
[ ] Create a Project Construction: POST /templates/:template_id/project_constructions.json
