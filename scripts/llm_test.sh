#!/bin/bash
API_KEY="AIzaSyC9-4TzL3AG-EpgYYqiW6GJF_4QDDmPuFY"

for MODEL in "models/gemini-flash-latest" "models/gemini-pro-latest"; do
    echo ">> TESTING FULL ID: $MODEL"
    # Note: URL pattern is /v1beta/{name}:generateContent
    # If MODEL is "models/X", then URL is /v1beta/models/X:generateContent
    curl -s https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${API_KEY} \
        -H 'Content-Type: application/json' \
        -X POST \
        -d '{"contents": [{"parts":[{"text": "ping"}]}]}' | grep -E "text|error|message"
done