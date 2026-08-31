from app.services.agent_stream import extract_partial_reply

assert extract_partial_reply('{"reply": "Hey') == "Hey"
assert extract_partial_reply('{"reply": "Hey! What') == "Hey! What"
assert extract_partial_reply('{"reply": "Line\\nbreak"}') == "Line\nbreak"
print("ok")
