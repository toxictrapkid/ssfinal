from data_types import Car
import time as t

def __score__(item: Car) -> int | None:
    score = 0

    if item.body == "Coupe":
        score += 2

    if item.sellerType == "Dealership":
        score += 20

    if item.city in ["Midvale", "Salt Lake City", "Murray"]:
        score += 10

    if item.transmission == "Automanual":
        score += 5

    if item.transmission == "Manual": return

    if "Red" in item.paint:
        score -=5

    if item.firstName == "Logan":
        score +=1

    if item.makeYear >= 2005:
        score += 5
    if item.makeYear >= 2015: return

    if item.mileage <= 125000:
        score += 10
    if item.mileage <= 90000: return

    if item.make in ["Toyota", "Mazda", "Honda"]:
        score += 10

    if item.make == "Ford":
        score -= 10
    if item.make == "Ford" and item.makeYear >= 2010 and item.model == "Focus": return

    if item.model in ["Corolla", "Camry", "Civic", "Accord", "Mazda3"]:
        score += 5

    if type(item.photo) == list:
        score += 1

    if item.price < 4500:
        score += 10
    if item.price <= 2000: return

    # If the car has been listed for longer than
    # a week
    if  item.displayTime - t.time() >= 604800:
        score -= 30

    return score