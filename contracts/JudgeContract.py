# { "Depends": "py-genlayer:test" }

import json
from genlayer import *


class JudgeContract(gl.Contract):

    def __init__(self) -> None:
        pass

    @gl.public.write
    def evaluate(
        self,
        source_code: str,
        seller_description: str,
        buyer_requirement: str,
    ) -> str:
        """
        Evaluates whether a piece of code matches a buyer's stated requirement.

        Called only when the buyer explicitly chooses Path B.
        The LLM call is wrapped in an inner function and passed to
        gl.eq_principle.prompt_comparative so validators independently run it
        and reach consensus before a result is accepted.

        Parameters
        ----------
        source_code        : Full plaintext source of the contract being sold.
                             Passed in-memory by the backend — never stored on-chain.
        seller_description : Seller's plain-English description of what the code does.
        buyer_requirement  : Buyer's plain-English description of what they need.

        Returns
        -------
        JSON string: { verdict, confidence, explanation, caveats }
        """

        prompt = f"""
You are an expert GenLayer intelligent contract auditor for a decentralized
code marketplace. A buyer is considering purchasing a piece of code and needs
an honest, technically accurate evaluation.

You will receive:
1. The seller's description of what the code does
2. The buyer's requirement — what they are looking for
3. The full source code of the contract

Your job:
- Read the source code carefully and understand what it actually does
- Compare it against the seller's description — does the code do what is claimed?
- Compare it against the buyer's requirement — does the code do what they need?
- Identify any caveats, limitations, or things the buyer should know

Respond with a single JSON object and nothing else.
No markdown, no backticks, no text outside the JSON.

{{
  "verdict": "<match | partial | mismatch>",
  "confidence": <integer between 0 and 100>,
  "explanation": "<2 to 4 sentences explaining your reasoning in plain English>",
  "caveats": ["<caveat one>", "<caveat two>"]
}}

Verdict definitions:
  match     — Code does what seller claims AND satisfies the buyer's requirement
  partial   — Code partially satisfies the requirement but is missing something
  mismatch  — Code does not match seller's claims or the buyer's requirement

SELLER DESCRIPTION:
{seller_description}

BUYER REQUIREMENT:
{buyer_requirement}

SOURCE CODE:
{source_code}

Respond only with the JSON object.
"""

        def run() -> str:
            result = gl.nondet.exec_prompt(prompt)
            result = result.replace("```json", "").replace("```", "").strip()
            return json.dumps(json.loads(result), sort_keys=True)

        final = gl.eq_principle.prompt_comparative(
            run,
            "The verdict field must be exactly one of: match, partial, or mismatch. "
            "The confidence must be an integer between 0 and 100. "
            "The explanation must be an honest technical assessment of whether "
            "the source code satisfies the buyer's requirement based on reading "
            "the actual code, not just the seller's description. "
            "The caveats list must contain only real limitations found in the code.",
        )

        return final
