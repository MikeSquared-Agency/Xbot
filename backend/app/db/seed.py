"""
Seed the FaultLine knowledge graph with legal doctrine, regulatory frameworks,
risk factors, and mitigation patterns.

This is the intellectual core of the product. The data here represents a
structured encoding of:
- How law applies to AI agent deployments
- What regulatory regimes exist
- What creates risk and what mitigates it

Run once at startup. Idempotent — checks for existing data before inserting.
"""
from app.db.client import db


async def seed_knowledge_graph():
    """Seed all knowledge graph tables. Idempotent."""
    existing = await db.query("SELECT count() FROM legal_domain GROUP ALL")
    count = 0
    if existing and existing[0].get("result"):
        result = existing[0]["result"]
        if isinstance(result, list) and len(result) > 0:
            count = result[0].get("count", 0)
    if count > 0:
        print("Knowledge graph already seeded, skipping.")
        return

    print("Seeding knowledge graph...")
    await _seed_legal_domains()
    await _seed_doctrines()
    await _seed_regulations()
    await _seed_risk_factors()
    await _seed_mitigations()
    await _seed_relationships()
    print("Knowledge graph seeded.")


async def _seed_legal_domains():
    domains = [
        {
            "name": "contract_law",
            "description": "Formation, validity, and enforcement of contracts — including whether AI agents can bind principals",
            "jurisdiction": "global",
            "volatility": "evolving",
            "relevance_to_agents": "AI agents that communicate with external parties may form binding contracts via apparent authority, electronic commerce legislation, or UETA/E-SIGN frameworks. Mistake doctrine is untested for probabilistic systems."
        },
        {
            "name": "tort_law",
            "description": "Negligence, product liability, misrepresentation — duty of care when deploying autonomous systems",
            "jurisdiction": "global",
            "volatility": "evolving",
            "relevance_to_agents": "Deploying an agentic system creates a duty of care. Standard of care for AI deployment is undefined — courts will likely apply existing negligence frameworks expansively. Product liability may apply under revised EU Product Liability Directive."
        },
        {
            "name": "data_protection",
            "description": "GDPR, automated decision-making, DPIAs, right to explanation",
            "jurisdiction": "EU/UK",
            "volatility": "settled",
            "relevance_to_agents": "Agents processing personal data trigger GDPR obligations. Article 22 restricts solely automated decisions with legal effects. DPIAs likely required for agentic deployments touching personal data."
        },
        {
            "name": "regulatory_compliance",
            "description": "Sector-specific and AI-specific regulation — EU AI Act, financial services, healthcare",
            "jurisdiction": "global",
            "volatility": "evolving",
            "relevance_to_agents": "EU AI Act risk classification may shift at runtime for general-purpose agents. Financial services agents face MiFID II, FCA Consumer Duty. Healthcare agents may trigger medical device regulations."
        },
        {
            "name": "intellectual_property",
            "description": "Copyright in AI outputs, training data rights, IP ownership of agent-generated work",
            "jurisdiction": "global",
            "volatility": "untested",
            "relevance_to_agents": "Agents generating content may infringe copyright. IP ownership of agent outputs is unclear in most jurisdictions. 92% of AI vendors claim broad data usage rights."
        },
        {
            "name": "employment_law",
            "description": "Algorithmic management, automated hiring decisions, worker surveillance",
            "jurisdiction": "global",
            "volatility": "evolving",
            "relevance_to_agents": "Agents making HR decisions (screening, performance assessment) trigger specific regulatory requirements under EU AI Act Annex III and local employment law."
        },
    ]
    for d in domains:
        await db.create("legal_domain", d)


async def _seed_doctrines():
    doctrines = [
        {
            "name": "apparent_authority",
            "domain": "contract_law",
            "description": "A principal is bound by the acts of their agent if a third party reasonably believed the agent had authority to act. If a company deploys an AI agent that customers interact with, the company may be bound by the agent's representations.",
            "jurisdiction": "global",
            "precedent_status": "analogous",
            "agent_relevance": "Companies deploying customer-facing agents create apparent authority. Even if the agent exceeds its intended mandate, the company may be bound if the third party reasonably relied on the agent's representations. Disclaimers help but do not eliminate liability.",
            "risk_direction": "increases_liability",
            "key_cases": ["Freeman & Lockyer v Buckhurst Park Properties", "Watteau v Fenwick"],
            "key_statutes": ["E-SIGN Act (US)", "UETA (US)", "Electronic Communications Act 2000 (UK)"],
        },
        {
            "name": "unilateral_mistake",
            "domain": "contract_law",
            "description": "A contract may be void if one party was mistaken about a fundamental term and the other party knew or ought to have known of the mistake.",
            "jurisdiction": "UK",
            "precedent_status": "untested",
            "agent_relevance": "If an AI agent enters a contract with hallucinated terms (wrong price, wrong quantity), the deploying company may argue unilateral mistake. But this defense is narrow — the other party must have known of the mistake, which is unlikely with automated systems.",
            "risk_direction": "uncertain",
            "key_cases": ["Hartog v Colin & Shields", "Smith v Hughes"],
            "key_statutes": [],
        },
        {
            "name": "negligent_misrepresentation",
            "domain": "tort_law",
            "description": "Making a false statement of fact carelessly, causing foreseeable loss to someone who reasonably relies on it.",
            "jurisdiction": "UK",
            "precedent_status": "established",
            "agent_relevance": "An AI agent that makes factual claims to customers (product specifications, pricing, legal/medical information) that turn out to be false can trigger negligent misrepresentation. The duty of care almost certainly exists in commercial relationships. Hallucination is the primary vector.",
            "risk_direction": "increases_liability",
            "key_cases": ["Hedley Byrne v Heller", "Caparo v Dickman"],
            "key_statutes": ["Misrepresentation Act 1967"],
        },
        {
            "name": "product_liability_software",
            "domain": "tort_law",
            "description": "Whether software (and by extension AI systems) constitutes a 'product' subject to strict liability.",
            "jurisdiction": "EU",
            "precedent_status": "evolving",
            "agent_relevance": "The revised EU Product Liability Directive (2024) explicitly includes software. AI systems are products. This means strict liability (no need to prove fault) may apply to defective AI agent outputs in the EU. The UK is still on the Consumer Protection Act 1987 which is ambiguous on software.",
            "risk_direction": "increases_liability",
            "key_cases": ["Donoghue v Stevenson (product liability foundation)"],
            "key_statutes": ["EU Product Liability Directive 2024", "Consumer Protection Act 1987 (UK)"],
        },
        {
            "name": "vicarious_liability",
            "domain": "tort_law",
            "description": "An employer/principal is liable for the wrongful acts of their employee/agent committed in the course of employment.",
            "jurisdiction": "global",
            "precedent_status": "analogous",
            "agent_relevance": "Companies are almost certainly vicariously liable for their AI agent's actions under respondeat superior. Unlike human agents, there is no 'frolic of his own' defence — the agent is always acting within the scope of its deployment, even when hallucinating.",
            "risk_direction": "increases_liability",
            "key_cases": ["Lister v Hesley Hall", "Various Claimants v Morrison Supermarkets"],
            "key_statutes": [],
        },
        {
            "name": "automated_decision_making",
            "domain": "data_protection",
            "description": "GDPR Article 22 — right not to be subject to solely automated decisions with legal or similarly significant effects.",
            "jurisdiction": "EU/UK",
            "precedent_status": "established",
            "agent_relevance": "Agentic systems making decisions that affect individuals (credit, insurance, employment, access to services) without meaningful human oversight may violate Article 22. 'Meaningful' human oversight requires the human to actually review and have authority to override — rubber-stamping doesn't count.",
            "risk_direction": "increases_liability",
            "key_cases": ["Uber BV v Haidar (Amsterdam, algorithmic management)"],
            "key_statutes": ["GDPR Article 22", "UK GDPR Article 22"],
        },
        {
            "name": "runtime_risk_classification",
            "domain": "regulatory_compliance",
            "description": "Under the EU AI Act, general-purpose agents may drift into high-risk use cases at runtime without the deployer intending it.",
            "jurisdiction": "EU",
            "precedent_status": "untested",
            "agent_relevance": "A general-purpose agent asked to 'handle my inbox' may classify emails (minimal risk), then screen a job application (high-risk under Annex III), then assess a customer complaint (potentially high-risk). The risk tier depends on how open-ended the prompt is. Generic agents default to high-risk classification unless high-risk uses are explicitly excluded.",
            "risk_direction": "increases_liability",
            "key_cases": [],
            "key_statutes": ["EU AI Act Article 6", "EU AI Act Annex III"],
        },
        {
            "name": "vendor_liability_asymmetry",
            "domain": "contract_law",
            "description": "AI vendor contracts systematically shift liability to deployers through broad disclaimers, limited indemnification, and liability caps.",
            "jurisdiction": "global",
            "precedent_status": "established",
            "agent_relevance": "92% of AI vendors claim broad data usage rights. Only 33% provide IP indemnification. Only 17% commit to regulatory compliance. The deploying company almost always bears the risk when an AI agent misbehaves. FTC v Rite Aid confirms companies cannot shift blame to vendors.",
            "risk_direction": "increases_liability",
            "key_cases": ["FTC v Rite Aid Corporation"],
            "key_statutes": [],
        },
    ]
    for d in doctrines:
        await db.create("doctrine", d)


async def _seed_regulations():
    regulations = [
        {
            "name": "Regulation (EU) 2024/1689 — EU Artificial Intelligence Act",
            "short_name": "EU AI Act",
            "jurisdiction": "EU",
            "status": "partial",
            "effective_date": "Prohibitions Feb 2025, GPAI Aug 2025, High-risk Aug 2027",
            "enforcer": "EU AI Office + national authorities",
            "max_penalty": "Up to 7% of global annual turnover or EUR 35M",
            "agent_relevance": "Risk-based classification. Agentic systems may fall under high-risk (Annex III) depending on use case. General-purpose agents face the runtime classification problem. GPAI obligations for model providers effective Aug 2025.",
            "compliance_requirements": ["Risk classification", "Conformity assessment (high-risk)", "Transparency obligations", "Human oversight requirements", "Record keeping (Article 12)", "Post-market monitoring"],
        },
        {
            "name": "General Data Protection Regulation",
            "short_name": "GDPR",
            "jurisdiction": "EU/UK",
            "status": "in_force",
            "effective_date": "2018-05-25",
            "enforcer": "ICO (UK), national DPAs (EU)",
            "max_penalty": "Up to 4% of global annual turnover or EUR 20M",
            "agent_relevance": "Agents processing personal data must have lawful basis. Automated decision-making with legal effects restricted under Article 22. DPIAs required for high-risk processing. Data minimisation applies to agent context windows.",
            "compliance_requirements": ["Lawful basis for processing", "DPIA for high-risk", "Article 22 compliance", "Right to explanation", "Data minimisation", "Records of processing"],
        },
        {
            "name": "FCA Consumer Duty",
            "short_name": "FCA Consumer Duty",
            "jurisdiction": "UK",
            "status": "in_force",
            "effective_date": "2023-07-31",
            "enforcer": "Financial Conduct Authority",
            "max_penalty": "Unlimited fines",
            "agent_relevance": "Financial services firms must act to deliver good outcomes for retail customers. AI agents providing financial information or advice must meet the same consumer duty standards as human advisors. Firms must be able to demonstrate they have appropriate oversight of AI outputs.",
            "compliance_requirements": ["Consumer understanding", "Products and services outcome", "Price and value outcome", "Consumer support outcome", "Monitoring and governance"],
        },
        {
            "name": "NIST AI Risk Management Framework",
            "short_name": "NIST AI RMF",
            "jurisdiction": "US",
            "status": "guidance_only",
            "effective_date": "2023-01-26",
            "enforcer": "None (voluntary)",
            "max_penalty": "None (but referenced in procurement and litigation)",
            "agent_relevance": "Provides structured approach to AI risk identification, assessment, and mitigation. Includes Generative AI Profile for LLM-specific risks. Increasingly referenced in insurance underwriting and litigation as a standard of care benchmark.",
            "compliance_requirements": ["Govern", "Map", "Measure", "Manage"],
        },
        {
            "name": "EU Product Liability Directive (Revised)",
            "short_name": "EU PLD 2024",
            "jurisdiction": "EU",
            "status": "in_force",
            "effective_date": "2024",
            "enforcer": "National courts",
            "max_penalty": "Unlimited (civil liability)",
            "agent_relevance": "Software is now explicitly a 'product'. AI agent outputs that cause harm may trigger strict product liability — no need to prove fault. Deployers and developers may both be liable. This is a significant change from fault-based negligence.",
            "compliance_requirements": ["Product safety requirements", "Defect documentation", "Post-market surveillance"],
        },
    ]
    for r in regulations:
        await db.create("regulation", r)


async def _seed_risk_factors():
    categories = [
        {"name": "technical", "description": "Risks arising from the AI system's capabilities, architecture, and failure modes"},
        {"name": "legal_exposure", "description": "Risks arising from the legal and regulatory environment"},
        {"name": "market", "description": "Risks arising from the insurance market and commercial context"},
    ]
    for c in categories:
        await db.create("risk_category", c)

    factors = [
        # Technical risk factors
        {
            "name": "autonomy_level",
            "category": "technical",
            "description": "How much independent action the agent can take without human approval",
            "measurement": "Classify as: fully_autonomous, human_on_the_loop, human_in_the_loop, human_in_command",
            "weight": 0.9,
            "levels": [
                {"level": "human_in_command", "score": 0.1, "criteria": "Human makes all decisions, agent only suggests"},
                {"level": "human_in_the_loop", "score": 0.3, "criteria": "Agent proposes, human approves each action"},
                {"level": "human_on_the_loop", "score": 0.6, "criteria": "Agent acts, human monitors and can intervene"},
                {"level": "fully_autonomous", "score": 1.0, "criteria": "Agent acts without any human oversight"},
            ],
        },
        {
            "name": "tool_permissions",
            "category": "technical",
            "description": "What external systems and actions the agent can invoke",
            "measurement": "Enumerate tools: read-only APIs, write APIs, financial transactions, email/comms, code execution",
            "weight": 0.85,
            "levels": [
                {"level": "read_only", "score": 0.1, "criteria": "Agent can only read data, no write actions"},
                {"level": "internal_write", "score": 0.3, "criteria": "Agent can modify internal records"},
                {"level": "external_communication", "score": 0.6, "criteria": "Agent can send emails, messages, or make representations to third parties"},
                {"level": "financial_transactional", "score": 0.9, "criteria": "Agent can execute payments, trades, or enter binding commitments"},
            ],
        },
        {
            "name": "data_access_scope",
            "category": "technical",
            "description": "What data the agent can access — PII, financial, health, privileged",
            "measurement": "Classify data types accessible: public, internal, PII, financial, health, privileged/legal",
            "weight": 0.7,
            "levels": [
                {"level": "public_only", "score": 0.1, "criteria": "Only public data"},
                {"level": "internal_non_sensitive", "score": 0.3, "criteria": "Internal data without PII or regulated categories"},
                {"level": "pii_financial", "score": 0.7, "criteria": "Personal data or financial records"},
                {"level": "health_legal_privileged", "score": 1.0, "criteria": "Health records, legal privilege, or classified data"},
            ],
        },
        {
            "name": "output_reach",
            "category": "technical",
            "description": "Who sees or relies on the agent's outputs",
            "measurement": "Classify: internal_only, customer_facing, public_facing, legally_binding",
            "weight": 0.8,
            "levels": [
                {"level": "internal_only", "score": 0.1, "criteria": "Outputs seen only by internal staff"},
                {"level": "customer_facing", "score": 0.5, "criteria": "Outputs seen by customers or partners"},
                {"level": "public_facing", "score": 0.7, "criteria": "Outputs visible to the general public"},
                {"level": "legally_binding", "score": 1.0, "criteria": "Outputs constitute legal commitments, contracts, or regulatory filings"},
            ],
        },
        {
            "name": "hallucination_risk",
            "category": "technical",
            "description": "Probability the agent produces factually incorrect outputs that are acted upon",
            "measurement": "Based on: model eval scores, domain specificity, output validation, structured output enforcement",
            "weight": 0.75,
            "levels": [
                {"level": "minimal", "score": 0.1, "criteria": "Structured outputs, validated against schema, domain-constrained"},
                {"level": "moderate", "score": 0.4, "criteria": "Free-form text with some validation"},
                {"level": "high", "score": 0.7, "criteria": "Free-form generation with no output validation"},
                {"level": "critical", "score": 1.0, "criteria": "Agent generates claims about facts (medical, legal, financial) without source grounding"},
            ],
        },
        {
            "name": "scope_creep_potential",
            "category": "technical",
            "description": "How likely the agent is to drift into unintended high-risk use cases at runtime",
            "measurement": "Based on: breadth of agent mandate, tool diversity, prompt openness",
            "weight": 0.65,
            "levels": [
                {"level": "constrained", "score": 0.1, "criteria": "Single-purpose agent with narrow tools and fixed prompts"},
                {"level": "moderate", "score": 0.4, "criteria": "Multi-purpose but within a defined domain"},
                {"level": "broad", "score": 0.7, "criteria": "General-purpose assistant with diverse tools"},
                {"level": "unbounded", "score": 1.0, "criteria": "Open-ended agent that determines its own sub-tasks and tool usage"},
            ],
        },
        # Legal exposure factors
        {
            "name": "jurisdiction_risk",
            "category": "legal_exposure",
            "description": "How favorable or unfavorable the legal jurisdiction is for AI deployment",
            "measurement": "Based on: regulatory maturity, litigation culture, precedent clarity",
            "weight": 0.7,
            "levels": [
                {"level": "favorable", "score": 0.2, "criteria": "Jurisdiction with clear AI-friendly regulation and limited litigation risk"},
                {"level": "moderate", "score": 0.5, "criteria": "Jurisdiction with emerging regulation, some precedent"},
                {"level": "unfavorable", "score": 0.8, "criteria": "Jurisdiction with strict regulation, active enforcement, high litigation culture"},
                {"level": "multi_jurisdiction", "score": 1.0, "criteria": "Agent operates across multiple jurisdictions with conflicting requirements"},
            ],
        },
        {
            "name": "precedent_clarity",
            "category": "legal_exposure",
            "description": "How clear the law is on AI agent liability in this deployment context",
            "measurement": "Based on: existing case law, statutory clarity, regulatory guidance",
            "weight": 0.6,
            "levels": [
                {"level": "clear", "score": 0.2, "criteria": "Well-established precedent directly applicable"},
                {"level": "analogous", "score": 0.5, "criteria": "Existing precedent can be applied by analogy"},
                {"level": "untested", "score": 0.8, "criteria": "No directly applicable precedent, outcome unpredictable"},
                {"level": "conflicting", "score": 1.0, "criteria": "Conflicting signals from different jurisdictions or courts"},
            ],
        },
        {
            "name": "vendor_indemnification",
            "category": "legal_exposure",
            "description": "Whether the AI vendor provides meaningful indemnification for agent failures",
            "measurement": "Review vendor contract terms for indemnification, liability caps, disclaimers",
            "weight": 0.5,
            "levels": [
                {"level": "full_indemnity", "score": 0.1, "criteria": "Vendor provides full indemnification for AI-related claims"},
                {"level": "partial", "score": 0.4, "criteria": "Vendor provides limited indemnification with caps"},
                {"level": "minimal", "score": 0.7, "criteria": "Vendor disclaims most liability, low caps"},
                {"level": "none", "score": 1.0, "criteria": "No indemnification, broad disclaimers, liability shifted entirely to deployer"},
            ],
        },
        # Market factors
        {
            "name": "sector_sensitivity",
            "category": "market",
            "description": "How sensitive the deployment sector is from a regulatory and public perception standpoint",
            "measurement": "Classify sector: low-sensitivity (internal tools), medium (B2B services), high (financial, healthcare, legal, education, employment)",
            "weight": 0.6,
            "levels": [
                {"level": "low", "score": 0.1, "criteria": "Internal productivity tools, no regulated data"},
                {"level": "medium", "score": 0.4, "criteria": "B2B services, commercial applications"},
                {"level": "high", "score": 0.7, "criteria": "Financial services, legal, education"},
                {"level": "critical", "score": 1.0, "criteria": "Healthcare, employment decisions, law enforcement, critical infrastructure"},
            ],
        },
    ]
    for f in factors:
        await db.create("risk_factor", f)


async def _seed_mitigations():
    mitigations = [
        # Legal conformity
        {"name": "eu_ai_act_conformity_assessment", "category": "legal_conformity", "description": "Completed EU AI Act conformity assessment for high-risk classification", "effectiveness": 0.8, "implementation_cost": "significant", "prerequisites": ["Risk classification completed"]},
        {"name": "dpia_completed", "category": "legal_conformity", "description": "Data Protection Impact Assessment completed and documented", "effectiveness": 0.7, "implementation_cost": "moderate", "prerequisites": ["Data processing activities mapped"]},
        {"name": "sector_regulatory_compliance", "category": "legal_conformity", "description": "Compliance with sector-specific regulation (FCA, MiFID, medical device, etc.)", "effectiveness": 0.9, "implementation_cost": "major", "prerequisites": ["Sector identified", "Regulatory requirements mapped"]},
        # Human oversight
        {"name": "qualified_hitl", "category": "human_oversight", "description": "Domain-expert human-in-the-loop with override authority for high-stakes decisions", "effectiveness": 0.85, "implementation_cost": "significant", "prerequisites": ["Qualified reviewers identified", "Escalation criteria defined"]},
        {"name": "cognitive_load_management", "category": "human_oversight", "description": "Review load calibrated to prevent alert fatigue — escalation-based rather than approve-all", "effectiveness": 0.6, "implementation_cost": "moderate", "prerequisites": ["Review volume measured", "Escalation thresholds defined"]},
        {"name": "override_rate_monitoring", "category": "human_oversight", "description": "Track and analyze how often human reviewers override agent decisions", "effectiveness": 0.4, "implementation_cost": "trivial", "prerequisites": ["HITL system in place"]},
        # Architectural controls
        {"name": "structured_output_enforcement", "category": "architectural", "description": "Agent outputs constrained to validated schemas — prevents free-form hallucination in critical fields", "effectiveness": 0.7, "implementation_cost": "moderate", "prerequisites": ["Output schemas defined"]},
        {"name": "tool_permission_scoping", "category": "architectural", "description": "Agent's tool access limited to minimum necessary — principle of least privilege", "effectiveness": 0.75, "implementation_cost": "moderate", "prerequisites": ["Tool inventory completed"]},
        {"name": "confidence_thresholds", "category": "architectural", "description": "Agent declines to act or escalates when confidence is below threshold", "effectiveness": 0.6, "implementation_cost": "moderate", "prerequisites": ["Calibration measured"]},
        {"name": "adversarial_robustness_testing", "category": "architectural", "description": "System tested against prompt injection, jailbreaking, and manipulation attacks", "effectiveness": 0.65, "implementation_cost": "significant", "prerequisites": ["Red team capability"]},
        {"name": "scope_constraints", "category": "architectural", "description": "Agent mandate explicitly bounded — cannot self-assign tasks outside defined scope", "effectiveness": 0.7, "implementation_cost": "moderate", "prerequisites": ["Scope definition documented"]},
        # Evidentiary position
        {"name": "comprehensive_audit_trail", "category": "evidentiary", "description": "Every agent decision, tool call, LLM invocation, and output logged with timestamps and context", "effectiveness": 0.5, "implementation_cost": "moderate", "prerequisites": ["Logging infrastructure"]},
        {"name": "prompt_version_control", "category": "evidentiary", "description": "Prompts versioned with linkage to outputs — can reconstruct what instructions produced what behaviour", "effectiveness": 0.4, "implementation_cost": "trivial", "prerequisites": []},
        {"name": "incident_response_plan", "category": "evidentiary", "description": "Documented plan for agent failures — detection, containment, notification, remediation", "effectiveness": 0.55, "implementation_cost": "moderate", "prerequisites": ["Risk scenarios identified"]},
        {"name": "vendor_contract_review", "category": "evidentiary", "description": "AI vendor contracts reviewed for indemnification, liability allocation, data usage rights", "effectiveness": 0.45, "implementation_cost": "moderate", "prerequisites": ["Legal review capability"]},
    ]
    for m in mitigations:
        await db.create("mitigation", m)


async def _seed_relationships():
    """Create edges between knowledge graph nodes."""
    # Doctrine relationships
    doctrine_rels = [
        ("apparent_authority", "vicarious_liability", "supports", "Apparent authority establishes agency, vicarious liability follows"),
        ("negligent_misrepresentation", "product_liability_software", "extends", "Product liability provides strict alternative to fault-based misrepresentation"),
        ("automated_decision_making", "runtime_risk_classification", "amplifies", "GDPR Article 22 restrictions compound with EU AI Act high-risk obligations"),
        ("vendor_liability_asymmetry", "vicarious_liability", "conflicts", "Vendor disclaimers attempt to shift liability that vicarious liability would impose on deployer"),
    ]
    for from_name, to_name, rel, desc in doctrine_rels:
        await db.query("""
            LET $from = (SELECT id FROM doctrine WHERE name = $from_name LIMIT 1);
            LET $to = (SELECT id FROM doctrine WHERE name = $to_name LIMIT 1);
            IF $from[0] AND $to[0] THEN
                RELATE ($from[0].id)->doctrine_relates->($to[0].id) SET
                    relationship = $rel,
                    description = $desc
            END
        """, {"from_name": from_name, "to_name": to_name, "rel": rel, "desc": desc})

    # Mitigation -> Risk Factor reduction edges
    mitigation_edges = [
        ("qualified_hitl", "autonomy_level", 0.6, None),
        ("qualified_hitl", "hallucination_risk", 0.5, None),
        ("structured_output_enforcement", "hallucination_risk", 0.7, None),
        ("tool_permission_scoping", "tool_permissions", 0.6, None),
        ("tool_permission_scoping", "scope_creep_potential", 0.5, None),
        ("scope_constraints", "scope_creep_potential", 0.7, None),
        ("adversarial_robustness_testing", "hallucination_risk", 0.3, None),
        ("eu_ai_act_conformity_assessment", "jurisdiction_risk", 0.5, "Only for EU jurisdiction"),
        ("dpia_completed", "data_access_scope", 0.3, "Reduces regulatory penalty risk, not data access itself"),
        ("comprehensive_audit_trail", "precedent_clarity", 0.2, "Improves evidentiary position but doesn't change law"),
        ("vendor_contract_review", "vendor_indemnification", 0.4, None),
        ("incident_response_plan", "hallucination_risk", 0.15, "Reduces severity not probability"),
        ("confidence_thresholds", "hallucination_risk", 0.5, None),
        ("confidence_thresholds", "scope_creep_potential", 0.3, None),
    ]
    for mit_name, rf_name, reduction, conditions in mitigation_edges:
        await db.query("""
            LET $mit = (SELECT id FROM mitigation WHERE name = $mit_name LIMIT 1);
            LET $rf = (SELECT id FROM risk_factor WHERE name = $rf_name LIMIT 1);
            IF $mit[0] AND $rf[0] THEN
                RELATE ($mit[0].id)->mitigates->($rf[0].id) SET
                    reduction = $reduction,
                    conditions = $conditions
            END
        """, {"mit_name": mit_name, "rf_name": rf_name, "reduction": reduction, "conditions": conditions})
