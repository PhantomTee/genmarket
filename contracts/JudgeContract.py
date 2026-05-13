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
        """
        Evaluates whether a public preview of GenLayer contract code appears
        consistent with the seller's description and the buyer's requirement.

        Important:
        This Judge does NOT review the full private source code.
        The full source remains encrypted off-chain and is only revealed after purchase.

        Parameters
        ----------
        source_code_preview : Public partial preview of the contract code.
                              This is visible on-chain and may be incomplete.
        seller_description  : Seller's plain-English description of what the code does.
        buyer_requirement   : Buyer's plain-English description of what they need.

        Returns
        -------
        JSON string: { verdict, confidence, explanation, caveats }
        """

        prompt = f"""
You are an expert GenLayer intelligent contract auditor for a decentralized
code marketplace. A buyer is considering purchasing a private full source code
listing, but you are only allowed to review the public preview.

You will receive:
1. The seller's description of what the code does
2. The buyer's requirement — what they are looking for
3. A public partial preview of the GenLayer contract code

Important limitations:
- This is NOT the full private source code.
- Do not claim you reviewed the hidden full source.
- Judge only whether the public preview, seller description, and buyer requirement are consistent.
- If the preview is too small to fully verify the listing, say that in the caveats.
- If the preview is plain English and not actual code, say so clearly.

Valid GenLayer intelligent contract code usually:
- starts with # {{ "Depends": "py-genlayer:test" }}
- imports from genlayer
- defines a class extending gl.Contract
- uses @gl.public.view, @gl.public.write, or @gl.public.write.payable
- uses GenLayer types like u256, Address, TreeMap, DynArray
- uses gl.message.sender_address, gl.message.value, or gl.transfer where needed

Respond with a single JSON object and nothing else.
No markdown, no backticks, no text outside the JSON.

{{
  "verdict": "<match | partial | mismatch>",
  "confidence": <integer between 0 and 100>,
  "explanation": "<2 to 4 sentences explaining your reasoning in plain English>",
  "caveats": ["<caveat one>", "<caveat two>"]
}}

Verdict definitions:
  match     — The preview strongly supports the seller's claim and buyer's requirement
  partial   — The preview shows some relevant logic but is incomplete or missing proof
  mismatch  — The preview does not match the seller's claim or buyer's requirement

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

            explanation = str(
                parsed.get(
                    "explanation",
                    "The Judge returned an incomplete response."
                )
            )

            caveats_raw = parsed.get("caveats", [])
            if not isinstance(caveats_raw, list):
                caveats_raw = []

            caveats = []
            for item in caveats_raw:
                caveats.append(str(item))

            return json.dumps({
                "verdict": verdict,
                "confidence": confidence,
                "explanation": explanation,
                "caveats": caveats,
            }, sort_keys=True)

        final = gl.eq_principle.prompt_comparative(
            run,
            "The JSON judgement must semantically match. The verdict must be match, partial, or mismatch. "
            "The confidence must be between 0 and 100. The explanation and caveats must assess whether "
            "the public GenLayer code preview and seller description satisfy the buyer requirement. "
            "The result must not claim to have reviewed hidden full source code.",
        )

        return final
