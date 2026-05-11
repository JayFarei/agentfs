#!/usr/bin/env python3
"""Lightweight SkillCraft local-tool bridge.

This imports official SkillCraft auxiliary tool bundles without booting the
native agent runner. It shims the small `agents.tool.FunctionTool` surface that
the bundle modules use at import time, then either lists tool schemas or invokes
one tool with JSON arguments.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import sys
import types
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


@dataclass
class FunctionTool:
    name: str
    description: str
    params_json_schema: dict[str, Any]
    on_invoke_tool: Callable[[Any, str], Any]


class RunContextWrapper:
    pass


BUNDLE_MAP = {
    "weather_tools": ("utils.aux_tools.weather_tools", "weather_tools"),
    "pokemon_tools": ("utils.aux_tools.pokemon_tools", "pokemon_tools"),
    "countries_tools": ("utils.aux_tools.countries_tools", "countries_tools"),
    "openlibrary_tools": ("utils.aux_tools.openlibrary_tools", "openlibrary_tools"),
    "jikan_api": ("utils.aux_tools.jikan_tools", "jikan_tools"),
    "tvmaze_api": ("utils.aux_tools.tvmaze_tools", "tvmaze_tools"),
    "usgs_earthquake_api": ("utils.aux_tools.usgs_earthquake_tools", "usgs_earthquake_tools"),
    "dnd_api": ("utils.aux_tools.dnd_tools", "dnd_api_tools"),
    "rickmorty_api": ("utils.aux_tools.rickmorty_tools", "rickmorty_tools"),
    "cocktail_api": ("utils.aux_tools.cocktail_tools", "cocktail_tools"),
    "mealdb_api": ("utils.aux_tools.mealdb_tools", "mealdb_tools"),
    "trivia_api": ("utils.aux_tools.trivia_tools", "trivia_tools"),
    "musicbrainz_api": ("utils.aux_tools.musicbrainz_tools", "musicbrainz_tools"),
    "dogapi": ("utils.aux_tools.dogapi_tools", "dogapi_tools"),
    "university_api": ("utils.aux_tools.university_tools", "university_tools"),
    "worldbank_api": ("utils.aux_tools.worldbank_tools", "worldbank_tools"),
    "namedemographics_api": ("utils.aux_tools.namedemographics_tools", "namedemographics_tools"),
    "dictionary_api": ("utils.aux_tools.dictionary_tools", "dictionary_tools"),
    "randomuser_api": ("utils.aux_tools.randomuser_tools", "randomuser_tools"),
    "jsonplaceholder_api": ("utils.aux_tools.jsonplaceholder_tools", "jsonplaceholder_tools"),
    "catfacts_api": ("utils.aux_tools.catfacts_tools", "catfacts_tools"),
    "nasa_api": ("utils.aux_tools.nasa_tools", "nasa_tools"),
    "gitlab_api": ("utils.aux_tools.gitlab_api", "gitlab_api_tools"),
    "dna_tools": ("utils.aux_tools.dna_tools", "dna_tools"),
    "decoder_tools": ("utils.aux_tools.decoder_tools", "decoder_tools"),
    "trade_tools": ("utils.aux_tools.trade_tools", "trade_tools"),
    "travel_tools": ("utils.aux_tools.travel_tools", "travel_tools"),
    "travel_tools_v2": ("utils.aux_tools.travel_tools_v2", "travel_tools_v2"),
    "travel_tools_merged": ("utils.aux_tools.travel_tools_merged", "travel_tools_merged"),
    "code_parser_tools": ("utils.aux_tools.code_parser_tools", "code_parser_tools"),
    "config_validator_tools": ("utils.aux_tools.config_validator_tools", "config_validator_tools"),
    "log_parser_tools": ("utils.aux_tools.log_parser_tools", "log_parser_tools"),
    "csv_tools": ("utils.aux_tools.csv_tools", "csv_tools"),
    "markdown_tools": ("utils.aux_tools.markdown_tools", "markdown_tools"),
    "file_classifier_tools": ("utils.aux_tools.file_classifier_tools", "file_classifier_tools"),
    "jsonplaceholder_tools": ("utils.aux_tools.jsonplaceholder_tools", "jsonplaceholder_tools"),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skillcraft-dir", required=True)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--tool")
    parser.add_argument("--args", default="{}")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()

    install_agents_shim()
    install_requests_shim()
    skillcraft_dir = Path(args.skillcraft_dir).resolve()
    sys.path.insert(0, str(skillcraft_dir))

    tools = load_bundle(args.bundle)
    if args.list:
        output({
            "bundle": args.bundle,
            "tools": [tool_descriptor(tool) for tool in tools],
        })
        return

    if not args.tool:
        raise SystemExit("--tool is required unless --list is set")
    tool = next((candidate for candidate in tools if candidate.name == args.tool), None)
    if tool is None:
        available = ", ".join(sorted(candidate.name for candidate in tools))
        raise SystemExit(f"tool not found in bundle {args.bundle}: {args.tool}; available: {available}")

    try:
        payload = json.loads(args.args)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid --args JSON: {exc}") from exc

    result = tool.on_invoke_tool(RunContextWrapper(), json.dumps(payload))
    if asyncio.iscoroutine(result):
        result = asyncio.run(result)
    output({
        "bundle": args.bundle,
        "tool": args.tool,
        "result": result,
    })


def install_agents_shim() -> None:
    agents_module = types.ModuleType("agents")
    tool_module = types.ModuleType("agents.tool")
    tool_module.FunctionTool = FunctionTool
    tool_module.RunContextWrapper = RunContextWrapper
    agents_module.tool = tool_module
    sys.modules.setdefault("agents", agents_module)
    sys.modules.setdefault("agents.tool", tool_module)


def install_requests_shim() -> None:
    try:
        import requests  # noqa: F401
        return
    except ModuleNotFoundError:
        pass

    requests_module = types.ModuleType("requests")

    class RequestException(Exception):
        pass

    class Timeout(RequestException):
        pass

    class Response:
        def __init__(self, status_code: int, body: bytes):
            self.status_code = status_code
            self.content = body
            self.text = body.decode("utf-8", errors="replace")

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RequestException(f"HTTP {self.status_code}")

        def json(self) -> Any:
            return json.loads(self.text)

    def get(url: str, headers: dict[str, str] | None = None, params: dict[str, Any] | None = None, timeout: int | float | None = None) -> Response:
        full_url = url
        if params:
            query = urllib.parse.urlencode({key: value for key, value in params.items() if value is not None})
            full_url = f"{url}{'&' if '?' in url else '?'}{query}"
        merged_headers = {"User-Agent": "Mozilla/5.0 (compatible; SkillCraft/1.0)"}
        merged_headers.update(headers or {})
        request = urllib.request.Request(full_url, headers=merged_headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return Response(response.status, response.read())
        except TimeoutError as exc:
            raise Timeout(str(exc)) from exc
        except urllib.error.URLError as exc:
            raise RequestException(str(exc)) from exc

    requests_module.get = get
    requests_module.RequestException = RequestException
    requests_module.Timeout = Timeout
    requests_module.exceptions = types.SimpleNamespace(RequestException=RequestException, Timeout=Timeout)
    sys.modules.setdefault("requests", requests_module)


def load_bundle(bundle: str) -> list[FunctionTool]:
    if bundle not in BUNDLE_MAP:
        known = ", ".join(sorted(BUNDLE_MAP))
        raise SystemExit(f"unknown bundle {bundle}; known bundles: {known}")
    module_name, attr = BUNDLE_MAP[bundle]
    module = importlib.import_module(module_name)
    tools = getattr(module, attr)
    return list(tools)


def tool_descriptor(tool: FunctionTool) -> dict[str, Any]:
    return {
        "name": tool.name,
        "description": tool.description,
        "params_json_schema": tool.params_json_schema,
    }


def output(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()
