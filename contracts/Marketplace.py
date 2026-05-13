# { "Depends": "py-genlayer:test" }

import json
from genlayer import *


class Marketplace(gl.Contract):

    owner: Address

    # ── Listing fields ────────────────────────────────────────────────────────
    listing_sellers:        TreeMap[str, Address]
    listing_titles:         TreeMap[str, str]
    listing_descriptions:   TreeMap[str, str]
    listing_prices:         TreeMap[str, u256]
    listing_categories:     TreeMap[str, str]
    listing_demo_addresses: TreeMap[str, str]
    listing_ipfs_cids:      TreeMap[str, str]
    listing_statuses:       TreeMap[str, str]
    listing_preview_codes:  TreeMap[str, str]
    listing_source_hashes:  TreeMap[str, str]

    # ── Escrow fields ─────────────────────────────────────────────────────────
    escrow_buyers:      TreeMap[str, Address]
    escrow_listing_ids: TreeMap[str, str]
    escrow_amounts:     TreeMap[str, u256]
    escrow_statuses:    TreeMap[str, str]
    escrow_voted:       TreeMap[str, bool]

    # ── Seller reputation ─────────────────────────────────────────────────────
    seller_upvotes:   TreeMap[str, u256]
    seller_downvotes: TreeMap[str, u256]

    # ── Index for iteration ───────────────────────────────────────────────────
    listing_ids:   DynArray[str]
    listing_count: u256

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.listing_count = u256(0)

    # ─────────────────────────────────────────────────────────────────────────
    # Listings
    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write
    def create_listing(
        self,
        title: str,
        description: str,
        price: u256,
        category: str,
        demo_contract_address: str,
        ipfs_cid: str,
        preview_code: str,
        source_hash: str,
    ) -> str:
        assert len(title) > 0, "Title cannot be empty"
        assert len(description) > 0, "Description cannot be empty"
        assert price > u256(0), "Price must be greater than zero"
        assert len(demo_contract_address) > 0, "Demo contract address is required"
        assert len(ipfs_cid) > 0, "IPFS CID is required"
        assert len(preview_code) > 0, "Preview code cannot be empty"
        assert len(preview_code) <= 4000, "Preview code is too long (max 4000 chars)"
        assert len(source_hash) > 0, "Source hash is required"

        listing_id = str(self.listing_count)
        seller = gl.message.sender_address

        self.listing_sellers[listing_id]        = seller
        self.listing_titles[listing_id]         = title
        self.listing_descriptions[listing_id]   = description
        self.listing_prices[listing_id]         = price
        self.listing_categories[listing_id]     = category
        self.listing_demo_addresses[listing_id] = demo_contract_address
        self.listing_ipfs_cids[listing_id]      = ipfs_cid
        self.listing_statuses[listing_id]       = "active"
        self.listing_preview_codes[listing_id]  = preview_code
        self.listing_source_hashes[listing_id]  = source_hash

        self.listing_ids.append(listing_id)
        self.listing_count += u256(1)

        return listing_id

    def _listing_dict(self, listing_id: str) -> dict:
        seller_hex = self.listing_sellers[listing_id].as_hex

        up = self.seller_upvotes[seller_hex] if seller_hex in self.seller_upvotes else u256(0)
        down = self.seller_downvotes[seller_hex] if seller_hex in self.seller_downvotes else u256(0)
        total = up + down

        score = str((up * u256(100)) // total) if total > u256(0) else "none"

        return {
            "id":                    listing_id,
            "seller":                seller_hex,
            "title":                 self.listing_titles[listing_id],
            "description":           self.listing_descriptions[listing_id],
            "price":                 str(self.listing_prices[listing_id]),
            "category":              self.listing_categories[listing_id],
            "demo_contract_address": self.listing_demo_addresses[listing_id],
            "ipfs_cid":              self.listing_ipfs_cids[listing_id],
            "status":                self.listing_statuses[listing_id],
            "preview_code":          self.listing_preview_codes[listing_id],
            "source_hash":           self.listing_source_hashes[listing_id],
            "seller_upvotes":        str(up),
            "seller_downvotes":      str(down),
            "seller_score":          score,
        }

    @gl.public.view
    def get_listing_json(self, listing_id: str) -> str:
        assert listing_id in self.listing_titles, "Listing not found"
        return json.dumps(self._listing_dict(listing_id), sort_keys=True)

    @gl.public.view
    def get_all_listings_json(self) -> str:
        result = []

        for listing_id in self.listing_ids:
            if self.listing_statuses[listing_id] == "active":
                result.append(self._listing_dict(listing_id))

        return json.dumps(result, sort_keys=True)

    @gl.public.view
    def get_listings_by_seller_json(self, seller_hex: str) -> str:
        result = []

        for listing_id in self.listing_ids:
            if self.listing_sellers[listing_id].as_hex.lower() == seller_hex.lower():
                result.append(self._listing_dict(listing_id))

        return json.dumps(result, sort_keys=True)

    @gl.public.view
    def get_listings_by_category_json(self, category: str) -> str:
        result = []

        for listing_id in self.listing_ids:
            if (
                self.listing_categories[listing_id] == category
                and self.listing_statuses[listing_id] == "active"
            ):
                result.append(self._listing_dict(listing_id))

        return json.dumps(result, sort_keys=True)

    @gl.public.write
    def remove_listing(self, listing_id: str) -> None:
        assert listing_id in self.listing_titles, "Listing not found"

        caller = gl.message.sender_address
        seller = self.listing_sellers[listing_id]

        assert caller == seller or caller == self.owner, "Not authorized"
        assert self.listing_statuses[listing_id] == "active", "Only active listings can be removed"

        self.listing_statuses[listing_id] = "removed"

    # ─────────────────────────────────────────────────────────────────────────
    # Escrow and payments
    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write.payable
    def buy(self, listing_id: str) -> str:
        assert listing_id in self.listing_titles, "Listing not found"

        caller = gl.message.sender_address
        seller = self.listing_sellers[listing_id]
        price = self.listing_prices[listing_id]

        assert self.listing_statuses[listing_id] == "active", "This listing is not available"
        assert caller != seller, "Seller cannot buy their own listing"
        assert gl.message.value >= price, "Insufficient payment sent"

        # One active escrow per listing.
        # This avoids frontend address-format guessing completely.
        escrow_id = listing_id

        # If this listing was previously refunded, allow a new buyer to reuse the listing id.
        if escrow_id in self.escrow_buyers:
            assert self.escrow_statuses[escrow_id] == "refunded", "Purchase already in progress"

        self.escrow_buyers[escrow_id] = caller
        self.escrow_listing_ids[escrow_id] = listing_id
        self.escrow_amounts[escrow_id] = gl.message.value
        self.escrow_statuses[escrow_id] = "locked"
        self.escrow_voted[escrow_id] = False

        self.listing_statuses[listing_id] = "pending"

        return escrow_id

    @gl.public.write
    def confirm_purchase(self, escrow_id: str) -> None:
        assert escrow_id in self.escrow_buyers, "Escrow not found"

        caller = gl.message.sender_address
        buyer = self.escrow_buyers[escrow_id]

        assert caller == buyer, "Only the buyer can confirm"
        assert self.escrow_statuses[escrow_id] == "locked", "Escrow is not locked"

        listing_id = self.escrow_listing_ids[escrow_id]
        seller = self.listing_sellers[listing_id]
        amount = self.escrow_amounts[escrow_id]

        gl.transfer(seller, amount)

        self.escrow_statuses[escrow_id] = "released"
        self.listing_statuses[listing_id] = "sold"

    @gl.public.write
    def refund(self, escrow_id: str) -> None:
        assert escrow_id in self.escrow_buyers, "Escrow not found"

        caller = gl.message.sender_address
        buyer = self.escrow_buyers[escrow_id]

        assert caller == buyer, "Only the buyer can refund"
        assert self.escrow_statuses[escrow_id] == "locked", "Escrow is not locked"

        listing_id = self.escrow_listing_ids[escrow_id]
        amount = self.escrow_amounts[escrow_id]

        gl.transfer(buyer, amount)

        self.escrow_statuses[escrow_id] = "refunded"
        self.escrow_voted[escrow_id] = False
        self.listing_statuses[listing_id] = "active"

    @gl.public.view
    def get_escrow_json(self, escrow_id: str) -> str:
        assert escrow_id in self.escrow_buyers, "Escrow not found"

        return json.dumps({
            "id": escrow_id,
            "buyer": self.escrow_buyers[escrow_id].as_hex,
            "listing_id": self.escrow_listing_ids[escrow_id],
            "amount": str(self.escrow_amounts[escrow_id]),
            "status": self.escrow_statuses[escrow_id],
        }, sort_keys=True)

    @gl.public.view
    def get_escrow_by_listing_json(self, listing_id: str) -> str:
        assert listing_id in self.listing_titles, "Listing not found"
        assert listing_id in self.escrow_buyers, "Escrow not found"

        escrow_id = listing_id

        return json.dumps({
            "id": escrow_id,
            "buyer": self.escrow_buyers[escrow_id].as_hex,
            "listing_id": self.escrow_listing_ids[escrow_id],
            "amount": str(self.escrow_amounts[escrow_id]),
            "status": self.escrow_statuses[escrow_id],
        }, sort_keys=True)

    # ─────────────────────────────────────────────────────────────────────────
    # Seller reputation and voting
    # ─────────────────────────────────────────────────────────────────────────

    @gl.public.write
    def vote_seller(self, escrow_id: str, is_upvote: bool) -> None:
        assert escrow_id in self.escrow_buyers, "Escrow not found"

        caller = gl.message.sender_address
        buyer = self.escrow_buyers[escrow_id]

        assert caller == buyer, "Only the buyer can vote"
        assert self.escrow_statuses[escrow_id] == "released", "Purchase must be confirmed before voting"

        if escrow_id in self.escrow_voted:
            assert self.escrow_voted[escrow_id] == False, "Already voted"

        listing_id = self.escrow_listing_ids[escrow_id]
        seller_hex = self.listing_sellers[listing_id].as_hex

        if is_upvote:
            current = self.seller_upvotes[seller_hex] if seller_hex in self.seller_upvotes else u256(0)
            self.seller_upvotes[seller_hex] = current + u256(1)
        else:
            current = self.seller_downvotes[seller_hex] if seller_hex in self.seller_downvotes else u256(0)
            self.seller_downvotes[seller_hex] = current + u256(1)

        self.escrow_voted[escrow_id] = True

    @gl.public.view
    def get_seller_reputation_json(self, seller_hex: str) -> str:
        up = self.seller_upvotes[seller_hex] if seller_hex in self.seller_upvotes else u256(0)
        down = self.seller_downvotes[seller_hex] if seller_hex in self.seller_downvotes else u256(0)

        total = up + down
        score = str((up * u256(100)) // total) if total > u256(0) else "none"

        return json.dumps({
            "seller": seller_hex,
            "up": str(up),
            "down": str(down),
            "total_votes": str(total),
            "score": score,
        }, sort_keys=True)

    @gl.public.view
    def has_voted_json(self, escrow_id: str) -> str:
        voted = False

        if escrow_id in self.escrow_voted:
            voted = self.escrow_voted[escrow_id]

        return json.dumps({
            "escrow_id": escrow_id,
            "voted": voted,
        }, sort_keys=True)