#!/bin/bash

# ARGUS RAG Proof-of-Concept Test (Fixed Payload)
API_KEY="AIzaSyC9-4TzL3AG-EpgYYqiW6GJF_4QDDmPuFY"
MODEL="models/gemini-flash-latest"

CONTEXT="BCH Chest X-ray (ds-001): Pediatric chest radiographs. Brain MRI (ds-005): Brain Tumor MRI Dataset."
QUERY="Computer, I am researching pediatric lung conditions. Which dataset should I use, and why?"

PROMPT="SYSTEM CONTEXT: You are the ARGUS computer. Use ONLY the following data: $CONTEXT\n\nUSER QUERY: $QUERY"

echo ">> INITIATING RAG PROOF TEST..."
echo "------------------------------------------------------------"

# Using jq or a clean JSON structure to avoid escaping hell
curl -s "https://generativelanguage.googleapis.com/v1beta/${MODEL}:generateContent?key=${API_KEY}" \
    -H 'Content-Type: application/json' \
    -X POST \
    -d "{
      \"contents\": [{
        \"parts\":[{
          \"text\": \"$PROMPT\" 
        }]
      }]
    }" | grep -A 20 "text"

echo ""
echo "------------------------------------------------------------"
echo ">> RAG PROOF TEST COMPLETE."