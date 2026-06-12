from dataclasses import dataclass
from typing import Callable

@dataclass
class ImageRequest:
    time_made: float
    image_url: str
    image_full_name: str
    callback: Callable[[str, bool], None]