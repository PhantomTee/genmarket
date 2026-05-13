# { "Depends": "py-genlayer:test" }

import json
from genlayer import *


class JudgeContract(gl.Contract):

    def __init__(self) -> None:
        pass

    @gl.public.write
    def evaluate(
        self,
        source_code_preview: str,
        seller_description: str,
        buyer_requirement: str,
    ) -> str:
        prompt = f"""
You are an expert GenLayer intelligent contract auditor for a decentralized
code marketplace.

You are reviewing a PUBLIC PREVIEW of a GenLayer intelligent contract.
This preview may not be the full private source — it is a partial snippet
chosen by the seller to represent their contract.

Valid GenLayer contract code typically:
- Starts with: # {{ "Depends": "py-genlayer:test" }}
- Imports from genlayer: from genlayer import *
- Defines a class extending gl.Contract
- Uses @gl.public.view, @gl.public.write, or @gl.public.write.payable decorators
- Uses GenLayer types: u256, Address, TreeMap, DynArray, str, bool
- Uses gl.message.sender_address, gl.message.value, gl.transfer where relevant

IMPORTANT RULES:
- Do NOT claim to have reviewed the full private source code.
- Do NOT treat plain English, JavaScript, Solidity, or generic Python as valid
  GenLayer intelligent contract code.
- If the preview is too short to fully verify the full product, say that in caveats.
- If the preview is plain English rather than code, return mismatch with confidence 100.
- Judge whether the visible preview AND seller description together satisfy the buyer requirement.

You will receive:
1. source_code_preview — the public partial code snippet
2. seller_description — the seller's plain-English description
3. buyer_requirement — what the buyer needs

Respond only with a single JSON object. No markdown, no backticks, no extra text.

{{
  "verdict": "<match | partial | mismatch>",
  "confidence": <integer 0-100>,
  "explanation": "<2-4 sentences>",
  "caveats": ["<caveat>"]
}}

Verdict definitions:
  match     — Preview and description together satisfy buyer requirement
  partial   — Partially satisfies but something is missing or unclear
  mismatch  — Does not match or description contradicts visible code

SELLER DESCRIPTION:
{seller_description}

BUYER REQUIREMENT:
{buyer_requirement}

PUBLIC CODE PREVIEW:
{source_code_preview}

Respond only with the JSON object.
"""

        def run() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.replace("```json", "").replace("```", "").strip()

            parsed = json.loads(result)

            verdict = str(parsed.get("verdict", "partial")).lower()
            if verdict not in ["match", "partial", "mismatch"]:
                verdict = "partial"

            confidence = int(parsed.get("confidence", 50))
            if confidence < 0:
                confidence = 0
            if confidence > 100:
                confidence = 100

            explanation = str(parsed.get("explanation", "The Judge returned an incomplete response."))

            caveats_raw = parsed.get("caveats", [])
            if not isinstance(caveats_raw, list):
                caveats_raw = []
            caveats = [str(item) for item in caveats_raw]

            return json.dumps({
                "verdict":     verdict,
                "confidence":  confidence,
                "explanation": explanation,
                "caveats":     caveats,
            }, sort_keys=True)

        final = gl.eq_principle.prompt_comparative(
            run,
            "The JSON judgement must semantically match. The verdict must be match, "
            "partial, or mismatch. The confidence must be between 0 and 100. "
            "The explanation and caveats must assess whether the public GenLayer code "
            "preview and seller description satisfy the buyer requirement. "
            "The result must not claim to have reviewed hidden full source code.",
        )

        return final
