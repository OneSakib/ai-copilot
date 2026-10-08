"""LangGraph pipeline:  classify (is it a question for me?)  ->  answer (stream)."""
from typing import List, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

import config


class State(TypedDict, total=False):
    transcript: List[dict]  # [{"speaker": "me"|"them", "text": str}]
    utterance: str          # the latest thing "them" said (may be empty on manual ask)
    context: str            # your resume / notes
    force: bool             # manual "Ask now" skips classification
    should_answer: bool
    answer: str


# fast = ChatAnthropic(model=config.FAST_MODEL, max_tokens=5, temperature=0)
fast = ChatAnthropic(model=config.FAST_MODEL, max_tokens=5)
# smart = ChatAnthropic(model=config.MAIN_MODEL, max_tokens=700, temperature=0.3)
smart = ChatAnthropic(model=config.MAIN_MODEL, max_tokens=700)


def text_of(content) -> str:
    """Anthropic content can be a str or a list of blocks."""
    if isinstance(content, str):
        return content
    return "".join(
        b.get("text", "") if isinstance(b, dict) else str(b) for b in content
    )


def render(transcript: List[dict], n: int = 14) -> str:
    return "\n".join(
        f"{'ME' if t['speaker'] == 'me' else 'THEM'}: {t['text']}"
        for t in transcript[-n:]
    )


async def classify(state: State) -> State:
    if state.get("force"):
        return {"should_answer": True}
    prompt = (
        "You watch a live conversation. Reply with only YES or NO.\n"
        "YES if THEM just asked a question, posed a problem, or made a request "
        "that ME needs to respond to. NO for small talk, acknowledgements, "
        "or statements needing no answer.\n\n"
        f"{render(state['transcript'])}"
    )
    res = await fast.ainvoke([HumanMessage(content=prompt)])
    return {"should_answer": text_of(res.content).strip().upper().startswith("Y")}


def route(state: State) -> str:
    return "answer" if state.get("should_answer") else END


async def answer(state: State) -> State:
    system = (
        "You are a real-time copilot whispering suggestions to ME during a live "
        "conversation. Write what ME can say next, in first person, natural and "
        "confident. Be brief: a 1-line direct answer first, then up to 4 short "
        "bullet points with key details. For code or technical questions, give "
        "the core idea and a compact snippet if needed. Never invent facts about "
        "ME; use only the background below, and say so if something is missing.\n\n"
        f"--- ME (background) ---\n{state.get('context', '')}"
    )
    user = (
        f"Conversation so far:\n{render(state['transcript'])}\n\n"
        "Write what ME should say now."
    )
    res = await smart.ainvoke([SystemMessage(content=system), HumanMessage(content=user)])
    return {"answer": text_of(res.content)}


def build_graph():
    g = StateGraph(State)
    g.add_node("classify", classify)
    g.add_node("answer", answer)
    g.add_edge(START, "classify")
    g.add_conditional_edges("classify", route, {"answer": "answer", END: END})
    g.add_edge("answer", END)
    return g.compile()


graph = build_graph()
