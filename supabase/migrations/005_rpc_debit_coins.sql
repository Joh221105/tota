CREATE OR REPLACE FUNCTION debit_coins(
  p_player_id UUID,
  p_amount INTEGER,
  p_transaction_type TEXT,
  p_idempotency_key TEXT,
  p_metadata JSONB
) RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
  v_balance_before INTEGER;
  v_balance_after INTEGER;
  v_txn_id UUID := gen_random_uuid();
BEGIN
  SELECT coins INTO v_balance_before FROM players WHERE id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAYER_NOT_FOUND:%', p_player_id;
  END IF;

  IF v_balance_before < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_FUNDS:%:%', v_balance_before, p_amount;
  END IF;

  v_balance_after := v_balance_before - p_amount;
  UPDATE players SET coins = v_balance_after WHERE id = p_player_id;

  INSERT INTO coin_transactions
    (id, player_id, direction, amount, transaction_type, balance_before, balance_after, idempotency_key, metadata)
  VALUES
    (v_txn_id, p_player_id, 'DEBIT', p_amount, p_transaction_type, v_balance_before, v_balance_after, p_idempotency_key, p_metadata);

  RETURN json_build_object(
    'success', true,
    'transactionId', v_txn_id,
    'balanceBefore', v_balance_before,
    'balanceAfter', v_balance_after,
    'idempotencyKey', p_idempotency_key
  );
END;
$$;
