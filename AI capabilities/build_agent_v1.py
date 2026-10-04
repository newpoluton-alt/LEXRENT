"""
Rental Housing Law Navigator - Claude Managed Agent over rag_knowledge_base.jsonl

Setup:
    pip install --upgrade anthropic
    Set API_KEY below (Console -> Settings -> API keys)
    python build_agent.py

First run creates the agent + environment and saves their IDs to agent_ids.json.
Later runs reuse them, upload the knowledge base, start a fresh session with the
file mounted, and open a chat loop. Type "exit" to quit.

The Managed Agents API is in beta; if a parameter name has changed, check
https://platform.claude.com/docs/en/managed-agents/quickstart
"""
import json
import sys
import os
from pathlib import Path

import anthropic

API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
MODEL = "claude-sonnet-5-5"          # or "claude-opus-5-5" for harder legal reasoning
KB_PATH = Path(__file__).resolve().parent / "rag_knowledge_base.jsonl"
IDS_PATH = Path(__file__).resolve().parent / "agent_ids.json"
MOUNT_PATH = "/mnt/session/uploads/rag_knowledge_base.jsonl"

SYSTEM_PROMPT = f"""\
You are the Rental Housing Law Navigator. You answer questions about which
housing rules apply to specific apartment addresses and about the law texts in
your knowledge base. You are a research aid, NOT a lawyer.

## Knowledge base
The file {MOUNT_PATH} is JSONL, one record per line (read-only). Record types:
- "law_chunk": a ~1,500-character piece of an official law/guide. Fields: id,
  doc_id, jurisdictions, url, source_type, retrieved_at, chunk_index, text.
- "source_link": a source with no captured text (only its URL and jurisdiction).
- "address": one apartment property. Fields: address_id, street_address,
  postal_city, state, zip, year_built, units, use_code, use_description,
  legal_city (always null until resolved).

## How to retrieve
Never answer from memory. Search the file first with bash (grep, jq, or a short
Python script). Search several phrasings and read the top chunks before
answering. To find an address, match street_address / address_id. To find laws
for an address, filter law_chunk records whose `jurisdictions` match the state
(e.g. "CA") or the resolved city (e.g. "Berkeley, CA"). Fetch neighbouring
chunks (same doc_id, adjacent chunk_index) when a passage is cut off.

## Jurisdiction rule
`postal_city` is a mailing city and is NOT always the legal city (e.g. Van Nuys
is inside the City of Los Angeles; Dorchester is inside Boston). If the legal
city is not certain, say so and explain which city-level laws would apply under
each possibility. You may use the Census Geocoder if network access allows;
otherwise say the jurisdiction is unresolved.

## Answer rules
1. Cite every rule: doc_id, source URL, and retrieved_at date. Never invent
   rules, section numbers, or citations. Quote sparingly and accurately.
2. State an "as of" date. Default is 2026-10-01 unless the user gives another.
3. Use these statuses when judging an address: applies, unknown, superseded
   (a stricter rule at another level governs), not_yet_effective, pending.
4. "Unknown" is a valid answer when coverage depends on facts the data lacks
   (missing year built, units, owner type, certificate-of-occupancy date).
   Say what fact is missing instead of guessing. Year built is not a certificate
   of occupancy: a building in a cutoff year is "unknown".
5. Separate enacted law from pending bills. Flag conflicts for human review.
6. Known open questions to surface when relevant: Berkeley ch. 13.63 has two
   published effective dates; NJ FAIR Act (effective 2027-07-01) may preempt
   Jersey City and Hoboken ordinances; the new Los Angeles RSO formula has two
   published effective dates; California's screening-fee cap has no single
   official 2026 figure; the Massachusetts rent-control ballot question was
   struck, so never report a rent cap in Boston or Cambridge.
7. Do not suggest ways to avoid or evade a rule. Do not use non-public data.
8. If the knowledge base has only a link-only source for a topic, say the text
   was not captured and give the URL.
9. End every substantive answer with: "Not legal advice. Summaries are for
   research only; consult a qualified attorney or the agency for your case."
"""


def get_ids(client: anthropic.Anthropic) -> dict:
    if IDS_PATH.exists():
        return json.loads(IDS_PATH.read_text())

    agent = client.beta.agents.create(
        name="Rental Housing Law Navigator",
        model=MODEL,
        system=SYSTEM_PROMPT,
        # Built-in toolset: bash, read, write, edit, glob, grep, web_fetch, web_search
        tools=[{"type": "agent_toolset_20260401"}],
    )
    environment = client.beta.environments.create(
        name="rental-law-env",
        config={"type": "cloud", "networking": {"type": "unrestricted"}},
    )
    ids = {"agent_id": agent.id, "environment_id": environment.id}
    IDS_PATH.write_text(json.dumps(ids, indent=2))
    print("Created:", ids)
    return ids


def ask(client, session_id: str, text: str) -> None:
    """Open the stream first, then send, then print until the session is idle."""
    with client.beta.sessions.events.stream(session_id) as stream:
        client.beta.sessions.events.send(
            session_id,
            events=[{"type": "user.message", "content": [{"type": "text", "text": text}]}],
        )
        for event in stream:
            if event.type == "agent.message":
                for block in event.content:
                    if block.type == "text":
                        print(block.text)
            elif event.type == "agent.tool_use":
                print("  [searching knowledge base...]", flush=True)
            elif event.type == "session.status_idle":
                break


def main() -> None:
    if not KB_PATH.exists():
        sys.exit(f"Put {KB_PATH} next to this script first.")
    if not API_KEY or API_KEY.startswith("PASTE_"):
        sys.exit("Set ANTHROPIC_API_KEY in your environment first.")
    client = anthropic.Anthropic(api_key=API_KEY)
    ids = get_ids(client)

    kb = client.files.upload(file=KB_PATH)
    session = client.beta.sessions.create(
        agent=ids["agent_id"],
        environment_id=ids["environment_id"],
        title="Rental law navigator",
        resources=[{"type": "file", "file_id": kb.id, "mount_path": MOUNT_PATH}],
    )
    print(f"Session: {session.id}")
    print(f"Watch live: https://platform.claude.com/workspaces/default/sessions/{session.id}")
    print('Ask about an address or a law. Type "exit" to quit.\n')

    while True:
        q = input("you> ").strip()
        if q.lower() in {"exit", "quit"}:
            break
        if q:
            ask(client, session.id, q)
            print()


if __name__ == "__main__":
    main()
