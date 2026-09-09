#!/usr/bin/env python3
"""Validate the JSON that drives the TTCircle simulator.

The site is static: every rate, band and description the pages use comes from
docs/data/*.json. A typo there breaks the module silently in the browser, so
this runs the checks a reviewer would do by hand.

    python scripts/check_data.py

Exits non-zero if anything is wrong, so it can gate a commit or a workflow.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"

problems: list[str] = []
notes: list[str] = []


def fail(message: str) -> None:
    problems.append(message)


def load(name: str) -> dict:
    path = DATA / name
    if not path.exists():
        fail(f"{name} is missing")
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        fail(f"{name} is not valid JSON: {err}")
        return {}


def check_tariffs(t: dict) -> None:
    """The underwriting model must be complete in both directions."""
    if not t:
        return

    modes = {m["value"] for m in t.get("transportModes", [])}
    for icc, rates in t.get("iccBaseRates", {}).items():
        missing = modes - set(rates)
        if missing:
            fail(f"tariffs.json: {icc} has no base rate for {', '.join(sorted(missing))}")

    # Every mode needs a container list, or the quotation form offers nothing.
    for mode in modes:
        if not t.get("containers", {}).get(mode):
            fail(f"tariffs.json: transport mode '{mode}' has no containers listed")

    # Every packaging option the form shows must have a risk factor.
    factors = t.get("packagingRiskFactors", {})
    for packing in t.get("packagingTypes", []):
        if packing not in factors:
            fail(f"tariffs.json: packaging '{packing}' has no risk factor")

    for condition in t.get("cargoConditions", []):
        if condition not in t.get("conditionRiskFactors", {}):
            fail(f"tariffs.json: condition '{condition}' has no risk factor")

    for cargo in t.get("cargoTypes", []):
        if cargo["value"] not in t.get("cargoRiskFactors", {}):
            fail(f"tariffs.json: cargo type '{cargo['value']}' has no risk factor")

    for extra in t.get("additionalCoverages", []):
        if extra["value"] not in t.get("additionalCoverageFactors", {}):
            fail(f"tariffs.json: extension '{extra['value']}' has no premium factor")

    # Incoterm coverage across the three tables.
    terms = set(t.get("incotermFactors", {}))
    described = set(t.get("incotermDescriptions", {}))
    if terms - described:
        fail(f"tariffs.json: no description for {', '.join(sorted(terms - described))}")
    if described - terms:
        fail(f"tariffs.json: description without a factor for {', '.join(sorted(described - terms))}")

    for term in t.get("maritimeOnlyIncoterms", []):
        if term not in terms:
            fail(f"tariffs.json: maritime-only Incoterm '{term}' has no factor")

    # The cover a rule falls back to must not itself be blocked.
    for term, rule in t.get("incotermRules", {}).items():
        if term not in terms:
            fail(f"tariffs.json: rule for unknown Incoterm '{term}'")
        if rule["minimumCover"] in rule["blocks"]:
            fail(f"tariffs.json: {term} blocks its own minimum cover {rule['minimumCover']}")
        if rule["minimumCover"] not in t.get("iccBaseRates", {}):
            fail(f"tariffs.json: {term} falls back to unknown cover {rule['minimumCover']}")

    # Countries flagged as risky must exist in the selectable list.
    countries = set(t.get("countries", []))
    for key in ("highRiskCountries", "mediumRiskCountries"):
        unknown = set(t.get(key, [])) - countries
        if unknown:
            fail(f"tariffs.json: {key} names countries not in the list: {', '.join(sorted(unknown))}")

    overlap = set(t.get("highRiskCountries", [])) & set(t.get("mediumRiskCountries", []))
    if overlap:
        fail(f"tariffs.json: {', '.join(sorted(overlap))} listed as both high and medium risk")


def check_risk_data(r: dict) -> None:
    if not r:
        return

    bands = set(r.get("bands", {}))
    for country, band in r.get("countries", {}).items():
        if band not in bands:
            fail(f"risk-data.json: {country} has unknown band '{band}'")

    countries = set(r.get("countries", {}))
    unknown = set(r.get("complexRouteCountries", [])) - countries
    if unknown:
        fail(f"risk-data.json: complex routes name unknown countries: {', '.join(sorted(unknown))}")

    covers = set(r.get("coverOptions", {}))
    for rec in r.get("recommendations", []):
        if rec["cover"] not in covers:
            fail(f"risk-data.json: recommendation points at unknown cover '{rec['cover']}'")

    # The bands must be ordered and reach the top, or a high score falls through.
    limits = [rec["maxLevel"] for rec in r.get("recommendations", [])]
    if limits != sorted(limits):
        fail("risk-data.json: recommendations are not in ascending maxLevel order")
    if limits and limits[-1] < 10:
        fail("risk-data.json: the last recommendation does not catch every score")


def check_config(c: dict) -> None:
    if not c:
        return

    codes = {level["code"] for level in c.get("coverLevels", [])}
    for cause in c.get("claimCauses", []):
        unknown = set(cause.get("coveredBy", [])) - codes
        if unknown:
            fail(f"config.json: claim cause '{cause['code']}' names unknown cover {', '.join(sorted(unknown))}")


def check_endpoints(e: dict) -> None:
    if not e:
        return

    for key in ("payment", "claims", "quotation"):
        url = e.get(key, "")
        if not url:
            notes.append(f"endpoints.json: '{key}' is empty — that stage cannot submit yet")
        elif not url.startswith("https://script.google.com/macros/s/"):
            fail(f"endpoints.json: '{key}' does not look like a deployed Apps Script /exec URL")
        elif not url.endswith("/exec"):
            fail(f"endpoints.json: '{key}' should end in /exec, not /dev")


def main() -> int:
    tariffs = load("tariffs.json")
    risk = load("risk-data.json")
    config = load("config.json")
    endpoints = load("endpoints.json")

    check_tariffs(tariffs)
    check_risk_data(risk)
    check_config(config)
    check_endpoints(endpoints)

    for note in notes:
        print(f"note: {note}")

    if problems:
        print()
        for problem in problems:
            print(f"error: {problem}")
        print(f"\n{len(problems)} problem(s) found.")
        return 1

    print("All data files are consistent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
