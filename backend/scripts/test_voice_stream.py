from app.services.agent_stream import extract_partial_reply, parse_stream_response

buf = "Sure — capacity planning matches staff to workload.\n\n---ACTIONS---\n{\"intent\":\"explain\",\"actions\":[]}"
assert extract_partial_reply(buf, voice=True).startswith("Sure")
assert parse_stream_response(buf, voice=True)["intent"] == "explain"

partial = extract_partial_reply("Hey there", voice=True)
assert partial == "Hey there"
print("ok")
