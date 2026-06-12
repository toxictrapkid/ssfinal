from dataclasses import dataclass

@dataclass
class Configuration:
    score_script_location: str
    url: str
    page_count: int
    user_agent: str